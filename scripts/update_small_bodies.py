"""
Download data for the sky tracker from NASA/JPL and save it as static files:

  sky/data/small-bodies.json      comet and asteroid orbits (Small-Body Database)
  sky/data/close-approaches.json  near-Earth objects passing close to Earth
                                  (Close-Approach Data API)

Runs once a day from .github/workflows/sky-data.yml. Visitors' browsers only
ever read the saved files, which follows JPL's fair-use policy
(https://ssd-api.jpl.nasa.gov/): one request at a time, results cached and
reused, an application-specific User-Agent, and the APIs are not embedded in
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

SBDB_API = "https://ssd-api.jpl.nasa.gov/sbdb_query.api"
CAD_API = "https://ssd-api.jpl.nasa.gov/cad.api"
USER_AGENT = "mars-alien.com sky tracker daily data update (github.com/colget/mars-alien-site)"
DATA = pathlib.Path(__file__).resolve().parent.parent / "sky" / "data"

CLOSE_APPROACH_LIMIT_AU = 0.05   # about 19.5 lunar distances: JPL's own default for "close"


def query(api, params, expected_version):
    url = api + "?" + urllib.parse.urlencode(params)
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
    if version != expected_version:
        print(f"  warning: JPL API version is {version}, expected {expected_version}")
    return {"fields": payload.get("fields", []), "data": payload.get("data", [])}


def month_start(year, month):
    """First day of a month; month may run past 12 (13 = January next year)."""
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    return dt.date(year, month, 1)


def save(name, content):
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / name).write_text(json.dumps(content, separators=(",", ":")))


def main():
    today = dt.datetime.now(dt.timezone.utc)
    stamp = today.strftime("%Y-%m-%dT%H:%MZ")
    jd_today = today.timestamp() / 86400 + 2440587.5
    cdata = lambda conds: json.dumps({"AND": conds}, separators=(",", ":"))

    # ---- comets and asteroids (required: if these fail, the whole run fails
    #      and yesterday's files stay in place)

    # Comets near perihelion within roughly a year either side: covers any
    # "this month + next month" window the page will show before the next update.
    print("Fetching comets...")
    comets = query(SBDB_API, {
        "fields": "full_name,e,q,i,om,w,tp,M1,K1",
        "sb-kind": "c", "sb-xfrag": "1", "full-prec": "1",
        "sb-cdata": cdata(["q|LT|3.5", "M1|DF", "K1|DF",
                           f"tp|RG|{jd_today - 400:.1f}|{jd_today + 460:.1f}"]),
    }, "1.0")
    time.sleep(2)                                      # one request at a time, unhurried

    # Asteroids big enough to reach binocular/small-telescope brightness.
    print("Fetching asteroids...")
    asteroids = query(SBDB_API, {
        "fields": "full_name,e,q,i,om,w,tp,H,G",
        "sb-kind": "a", "full-prec": "1",
        "sb-cdata": cdata(["H|LT|8", "e|LT|1"]),
    }, "1.0")

    if not comets["data"] and not asteroids["data"]:
        sys.exit("JPL returned no objects at all -- keeping the old files.")

    save("small-bodies.json", {
        "updated": stamp,
        "source": "NASA/JPL Small-Body Database Query API",
        "comets": comets,
        "asteroids": asteroids,
    })
    print(f"Saved {len(comets['data'])} comets and {len(asteroids['data'])} asteroids")

    # ---- close approaches (optional: if this fails, keep yesterday's file)
    # From the 1st of this month to the end of the month after next, so the
    # file still covers a visitor's "this month + next" window on the 1st,
    # before the day's update has run.
    time.sleep(2)
    first = month_start(today.year, today.month)
    until = month_start(today.year, today.month + 3)
    print(f"Fetching close approaches {first} to {until}...")
    try:
        approaches = query(CAD_API, {
            "date-min": first.isoformat(),
            "date-max": until.isoformat(),
            "dist-max": str(CLOSE_APPROACH_LIMIT_AU),
            "fullname": "true",
            "diameter": "true",
            "sort": "date",
        }, "1.5")
    except Exception as exc:
        print(f"  warning: close approaches not updated ({exc}); keeping the old file")
        return

    save("close-approaches.json", {
        "updated": stamp,
        "source": "NASA/JPL SBDB Close-Approach Data API",
        "from": first.isoformat(),
        "until": until.isoformat(),
        "distMaxAU": CLOSE_APPROACH_LIMIT_AU,
        **approaches,
    })
    print(f"Saved {len(approaches['data'])} close approaches")


if __name__ == "__main__":
    main()
