import json, csv, statistics as st, collections as C
QF = 420/4  # filter question tokens (~4 chars per token)
meta = {r["news_id"]: r for r in csv.DictReader(open("results/jev/corpus_filter/filter.csv", encoding="utf-8"))}
tok = {}
for line in open("results/jev/corpus_filter/answers.jsonl", encoding="utf-8"):
  r = json.loads(line); tok[r["news_id"]] = r["input_tokens"] - QF
ids100 = [l.strip() for l in open("results/jev/test100/news_ids.txt") if l.strip()]
print("test100 news mean tokens", round(st.mean(tok[i] for i in ids100 if i in tok)))
def summ(ids):
  t = [tok[i] for i in ids]
  return len(t), round(st.mean(t)), round(st.median(t)), round(sorted(t)[int(.9*len(t))]), round(sum(t)/1e6, 2)
allids = list(tok); passids = [i for i in allids if meta[i]["passes"] == "1"]
print("ALL  n mean median p90 Mtok", summ(allids)); print("PASS", summ(passids))
by = C.defaultdict(list); byp = C.defaultdict(list); bym = C.defaultdict(list); bymp = C.defaultdict(list)
for i in allids:
  o = meta[i]["outlet"]; m = meta[i]["date"][:7]
  by[o].append(i); bym[(o, m)].append(i)
  if meta[i]["passes"] == "1": byp[o].append(i); bymp[(o, m)].append(i)
print("\noutlet | n | mean | median | p90 | Mtok | pass | pass% | pass_mean | cut")
for o in sorted(by, key=lambda o: -len(by[o])):
  n, me, md, p9, mt = summ(by[o]); np_ = len(byp[o])
  cut = sum(meta[i]["cut"] == "1" for i in by[o])
  print(o, n, me, md, p9, mt, np_, round(100*np_/n, 1), round(st.mean(tok[i] for i in byp[o])), cut, sep=" | ")
months = sorted({m for _, m in bym})
print("\nmonth news count / mean tokens / pass count per outlet")
for o in sorted(by, key=lambda o: -len(by[o])):
  print(o, " ; ".join(f"{m}: {len(bym[(o,m)])} / {round(st.mean(tok[i] for i in bym[(o,m)])) if bym[(o,m)] else '-'} / {len(bymp[(o,m)])}" for m in months))
print("TOTAL", " ; ".join(f"{m}: {sum(len(bym[(o,m)]) for o in by)} / {sum(len(bymp[(o,m)]) for o in by)}" for m in months))

P = 0.042e-6; K = 50; G = 97; CG = 597; D = 1930; QN = 480; CD = 613; RM = 46/101; B = 83/46; PM = 32*75
print("\noutlet | filter $ | gate $ | detail $ | total $ | $ per 1000 news")
tot = [0]*3
for o in sorted(by, key=lambda o: -len(by[o])):
  f = sum(tok[i] + QF for i in by[o]) * P
  tp = st.mean(tok[i] for i in byp[o]); npp = len(byp[o])
  g = npp * (tp + G + K*CG) * P
  d = npp * RM * (tp + D + QN + B*(CD + PM)) * P
  for j, x in enumerate((f, g, d)): tot[j] += x
  print(o, round(f, 3), round(g, 3), round(d, 3), round(f+g+d, 2), round(1000*(f+g+d)/len(by[o]), 3), sep=" | ")
print("TOTAL", [round(x, 3) for x in tot], round(sum(tot), 2))
print("\nmonth | news | mean tok | pass | Mtok filter")
for m in months:
  ids = [i for i in allids if meta[i]["date"][:7] == m]
  print(m, len(ids), round(st.mean(tok[i] for i in ids)), sum(meta[i]["passes"] == "1" for i in ids), round(sum(tok[i]+QF for i in ids)/1e6, 2), sep=" | ")
