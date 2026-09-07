import asyncio
import io
import urllib.error

import server


class _FakeUpstream:
    """Context manager mimicking urllib.request.urlopen's response object."""

    def __init__(self, status: int, body: bytes):
        self.status = status
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class TestCachedUmamiScript:
    def _reset(self, monkeypatch):
        monkeypatch.setattr(server, "_umami_script_cache", None)

    def test_fetches_once_within_ttl(self, monkeypatch):
        self._reset(monkeypatch)
        calls = []
        monkeypatch.setattr(
            server, "_fetch_umami_script", lambda: calls.append(1) or b"js-v1"
        )
        assert server._cached_umami_script(1000.0) == b"js-v1"
        assert server._cached_umami_script(1000.0 + 60) == b"js-v1"
        assert len(calls) == 1

    def test_refetches_after_ttl(self, monkeypatch):
        self._reset(monkeypatch)
        versions = iter([b"js-v1", b"js-v2"])
        monkeypatch.setattr(server, "_fetch_umami_script", lambda: next(versions))
        assert server._cached_umami_script(1000.0) == b"js-v1"
        after_ttl = 1000.0 + server._UMAMI_SCRIPT_TTL_SECONDS + 1
        assert server._cached_umami_script(after_ttl) == b"js-v2"

    def test_serves_stale_copy_when_refresh_fails(self, monkeypatch):
        self._reset(monkeypatch)
        fetched = []

        def fetch():
            if fetched:
                raise OSError("upstream down")
            fetched.append(1)
            return b"js-v1"

        monkeypatch.setattr(server, "_fetch_umami_script", fetch)
        assert server._cached_umami_script(1000.0) == b"js-v1"
        after_ttl = 1000.0 + server._UMAMI_SCRIPT_TTL_SECONDS + 1
        assert server._cached_umami_script(after_ttl) == b"js-v1"

    def test_none_when_never_fetched(self, monkeypatch):
        self._reset(monkeypatch)

        def fetch():
            raise OSError("upstream down")

        monkeypatch.setattr(server, "_fetch_umami_script", fetch)
        assert server._cached_umami_script(1000.0) is None

    def test_endpoint_serves_script_with_cache_header(self, monkeypatch):
        self._reset(monkeypatch)
        monkeypatch.setattr(server, "_fetch_umami_script", lambda: b"js-v1")
        resp = asyncio.run(server.umami_script())
        assert resp.status_code == 200
        assert resp.body == b"js-v1"
        assert resp.headers["cache-control"] == "public, max-age=3600"

    def test_endpoint_502_when_upstream_never_reachable(self, monkeypatch):
        self._reset(monkeypatch)

        def fetch():
            raise OSError("upstream down")

        monkeypatch.setattr(server, "_fetch_umami_script", fetch)
        resp = asyncio.run(server.umami_script())
        assert resp.status_code == 502


class TestForwardUmamiSend:
    def test_forwards_body_and_identity_headers(self, monkeypatch):
        seen = {}

        def fake_urlopen(req, timeout):
            seen["url"] = req.full_url
            seen["body"] = req.data
            seen["ua"] = req.get_header("User-agent")
            seen["xff"] = req.get_header("X-forwarded-for")
            return _FakeUpstream(200, b'{"cache":"tok"}')

        monkeypatch.setattr(server.urllib.request, "urlopen", fake_urlopen)
        status, payload = server._forward_umami_send(
            b'{"type":"event"}', "TestBrowser/1.0", "203.0.113.9"
        )
        assert (status, payload) == (200, b'{"cache":"tok"}')
        assert seen["url"] == f"{server.UMAMI_HOST}/api/send"
        assert seen["body"] == b'{"type":"event"}'
        assert seen["ua"] == "TestBrowser/1.0"
        assert seen["xff"] == "203.0.113.9"

    def test_passes_through_upstream_http_error(self, monkeypatch):
        def fake_urlopen(req, timeout):
            raise urllib.error.HTTPError(
                req.full_url, 403, "Forbidden", hdrs=None, fp=io.BytesIO(b"limit")
            )

        monkeypatch.setattr(server.urllib.request, "urlopen", fake_urlopen)
        status, payload = server._forward_umami_send(b"{}", "TestBrowser/1.0", "")
        assert (status, payload) == (403, b"limit")
