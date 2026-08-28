from collections import deque
from datetime import UTC,datetime
from typing import Mapping
from urllib.parse import parse_qs
import pytest
from garmin_sync.eight_sleep_client import AUTH_URL,CLIENT_API_BASE_URL,EightSleepAuthenticationError,EightSleepClient,EightSleepHttpResponse,EightSleepRateLimitError
from garmin_sync.eight_sleep_config import EightSleepSettings
class FakeTransport:
    def __init__(self,responses: list[EightSleepHttpResponse]) -> None: self.responses=deque(responses); self.calls: list[dict[str,object]]=[]
    def request(self,*,method: str,url: str,headers: Mapping[str,str],data: bytes|None,timeout: float) -> EightSleepHttpResponse: self.calls.append({"method":method,"url":url,"headers":dict(headers),"data":data}); return self.responses.popleft()
def r(status: int,body: str,**headers: str) -> EightSleepHttpResponse: return EightSleepHttpResponse(status,headers,body.encode())
def settings(**kw: object) -> EightSleepSettings:
    data={"enabled":True,"email":"a@b.test","password":"pw","client_id":"cid","client_secret":"cs","user_id":"u","max_retries":2}; data.update(kw); return EightSleepSettings(**data)  # type: ignore[arg-type]
def test_auth_uses_explicit_client_credentials_and_reuses_token() -> None:
    t=FakeTransport([r(200,'{"access_token":"a","expires_in":3600,"userId":"u"}'),r(200,'{"days":[]}'),r(200,'{"days":[]}')]); c=EightSleepClient(settings(),transport=t,sleep_fn=lambda _:None,now_fn=lambda:datetime(2026,8,28,tzinfo=UTC)); c.get_trends(from_date="2026-08-27",to_date="2026-08-29",timezone="Europe/Warsaw"); c.get_trends(from_date="2026-08-27",to_date="2026-08-29",timezone="Europe/Warsaw"); form=parse_qs((t.calls[0]["data"] or b"").decode()); assert t.calls[0]["url"]==AUTH_URL and form["client_secret"]==["cs"] and sum(x["url"]==AUTH_URL for x in t.calls)==1
def test_trends_endpoint_and_query() -> None:
    t=FakeTransport([r(200,'{"access_token":"a","expires_in":3600,"userId":"u"}'),r(200,'{"days":[]}')]); EightSleepClient(settings(),transport=t,sleep_fn=lambda _:None).get_trends(from_date="2026-08-27",to_date="2026-08-29",timezone="Europe/Warsaw"); url=str(t.calls[1]["url"]); assert url.startswith(f"{CLIENT_API_BASE_URL}/users/u/trends?") and "model-version=v2" in url
def test_401_reauthenticates_once_then_fails_closed() -> None:
    t=FakeTransport([r(200,'{"access_token":"a","expires_in":3600,"userId":"u"}'),r(401,'{}'),r(200,'{"access_token":"b","expires_in":3600,"userId":"u"}'),r(401,'{}')]); c=EightSleepClient(settings(),transport=t,sleep_fn=lambda _:None)
    with pytest.raises(EightSleepAuthenticationError): c.get_trends(from_date="2026-08-27",to_date="2026-08-29",timezone="Europe/Warsaw")
def test_429_retry_is_bounded() -> None:
    t=FakeTransport([r(200,'{"access_token":"a","expires_in":3600,"userId":"u"}'),r(429,'{}',**{"Retry-After":"0"}),r(429,'{}')]); c=EightSleepClient(settings(max_retries=1),transport=t,sleep_fn=lambda _:None)
    with pytest.raises(EightSleepRateLimitError): c.get_trends(from_date="2026-08-27",to_date="2026-08-29",timezone="Europe/Warsaw")
