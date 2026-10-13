"""
Download comet and asteroid orbits from NASA/JPL's Small-Body Database
and save them as sky/data/small-bodies.json for the sky tracker.

Runs once a day from .github/workflows/sky-data.yml. Visitors' browsers only
ever read the saved file, which follows JPL's fair-use policy
(https://ssd-api.jpl.nasa.gov/): one request at a time, results cached and
reused, an application-specific User-Agent, and the API is not embedded in
the website.

Standard library only:  python scripts/update_small_bodies.py
"""

import datetime as dt
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

API = "https://ssd-api.jpl.nasa.gov/sbdb_query.api"
USER_AGENT = "mars-alien.com sky tracker daily data update (github.com/colget/mars-alien-site)"
OUT = pathlib.Path(__file__).resolve().parent.parent / "sky" / "data" / "small-bodies.json"
EXPECTED_VERSION = "1.0"


def query(params):
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.load(resp)
            break
        except Exception as exc:                      # back off politely, then give up
            if attempt == 2:
                raise
            wait = 60 * (attempt + 1)
            print(f"  request failed ({exc}); retrying in {wait}s")
            time.sleep(wait)
    version = payload.get("signature", {}).get("version")
    if version != EXPECTED_VERSION:
        print(f"  warning: JPL API version is {version}, expected {EXPECTED_VERSION}")
    return {"fields": payload["fields"], "data": payload.get("data", [])}


def main():
    today = dt.datetime.now(dt.timezone.utc)
    jd_today = today.timestamp() / 86400 + 2440587.5
    cdata = lambda conds: json.dumps({"AND": conds}, separators=(",", ":"))

    # Comets near perihelion within roughly a year either side: covers any
    # "this month + next month" window the page will show before the next update.
    print("Fetching comets...")
    comets = query({
        "fields": "full_name,e,q,i,om,w,tp,M1,K1",
        "sb-kind": "c", "sb-xfrag": "1", "full-prec": "1",
        "sb-cdata": cdata(["q|LT|3.5", "M1|DF", "K1|DF",
                           f"tp|RG|{jd_today - 400:.1f}|{jd_today + 460:.1f}"]),
    })
    time.sleep(2)                                      # one request at a time, unhurried

    # Asteroids big enough to reach binocular/small-telescope brightness.
    print("Fetching asteroids...")
    asteroids = query({
        "fields": "full_name,e,q,i,om,w,tp,H,G",
        "sb-kind": "a", "full-prec": "1",
        "sb-cdata": cdata(["H|LT|8", "e|LT|1"]),
    })

    if not comets["data"] and not asteroids["data"]:
        sys.exit("JPL returned no objects at all -- keeping the old file.")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "updated": today.strftime("%Y-%m-%dT%H:%MZ"),
        "source": "NASA/JPL Small-Body Database Query API",
        "comets": comets,
        "asteroids": asteroids,
    }, separators=(",", ":")))
    print(f"Saved {len(comets['data'])} comets and {len(asteroids['data'])} asteroids to {OUT}")


if __name__ == "__main__":
    main()
