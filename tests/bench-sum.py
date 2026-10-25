# Adds up bench.js lines (stdin): the new bot's edge per hand over the old, with ±2 SE.
import sys, json, math
t = {}
for line in sys.stdin:
    line = line.strip()
    if not line.startswith('{'): continue
    for k, v in json.loads(line).items(): t[k] = t.get(k, 0) + v
n = t['deals']
mean = (t['newScore'] - t['oldScore']) / n            # per deal (3 hands)
var = t['diffSq'] / n - mean * mean
se = math.sqrt(var / n)
print(f"{n} deals, {t['hands']} hands: new {t['newScore']/t['hands']:.2f} vs old {t['oldScore']/t['hands']:.2f} a hand; "
      f"edge {mean/3:+.2f} ±{2*se/3:.2f} a hand; new bids {t['newBids']} made {t['newMade']/max(1,t['newBids']):.0%}, "
      f"old bids {t['oldBids']} made {t['oldMade']/max(1,t['oldBids']):.0%}; thrown in {t['thrown']}; "
      f"points fed to the bidder: new {t.get('newFeeds',0)}, old {t.get('oldFeeds',0)} (old has 2 seats); {t['ms']/1000/ (t['hands'] or 1):.2f} s a hand-cpu")
