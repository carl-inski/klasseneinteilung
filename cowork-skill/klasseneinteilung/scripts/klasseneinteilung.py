#!/usr/bin/env python3
"""Klasseneinteilung — Engine für den Cowork-Skill.

Selbstständige Python-Portierung der getesteten Solver-Logik. Nur `openpyxl`
wird benötigt (im Cowork-Container vorinstalliert; sonst: pip install openpyxl).

Subcommands (alle arbeiten in einem Arbeitsordner, Standard ./ke_arbeit):

  prep   <datei.xlsx> [--work DIR] [--config config.json]
         Liest die Excel, erkennt Spalten+Rollen, anonymisiert (Codes S001…),
         löst Wünsche/„nicht mit“ tolerant auf. Schreibt mapping.json (Code→Name,
         BLEIBT LOKAL), students.json (nur Codes), unresolved.json (offene
         Nennungen + Kandidaten) und — falls nicht vorhanden — config.json.
         Mit --config werden Spalten-Overrides und manuelle Korrekturen angewandt.

  solve  [--work DIR] [--seed N]
         Rechnet die Einteilung nach config.json (harte + weiche Kriterien).
         Schreibt assignment.json und gibt eine Übersicht aus.

  export [--work DIR] [--out DATEI.xlsx]
         Baut die fertige Excel (de-anonymisiert): Gesamtliste, Blatt pro Klasse,
         Statistik.

Datenfluss:  prep → (config.json bearbeiten) → solve → (wiederholen) → export
"""
from __future__ import annotations
import argparse
import json
import os
import random
import re
import sys
from collections import defaultdict

try:
    import openpyxl
except ImportError:
    sys.exit("Bitte 'openpyxl' installieren:  pip install openpyxl")

# --------------------------------------------------------------------------- #
#  Hilfsfunktionen: Normalisierung & Fuzzy-Namensauflösung
# --------------------------------------------------------------------------- #
def norm(s: str) -> str:
    s = (s or "").lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z]", "", s)


def edit_distance(a: str, b: str) -> int:
    dp = list(range(len(a) + 1))
    for j in range(1, len(b) + 1):
        prev = dp[0]
        dp[0] = j
        for i in range(1, len(a) + 1):
            tmp = dp[i]
            dp[i] = min(dp[i] + 1, dp[i - 1] + 1, prev + (0 if a[i - 1] == b[j - 1] else 1))
            prev = tmp
    return dp[len(a)]


# --------------------------------------------------------------------------- #
#  Spaltenerkennung
# --------------------------------------------------------------------------- #
ROLE_KEYWORDS = [
    ("firstName", ["rufname", "vorname", "vornamen", "first name", "given name"]),
    ("lastName", ["nachname", "familienname", "surname", "last name"]),
    ("fullName", ["name des kindes", "schueler", "schülerin", "kind", "full name", "name"]),
    ("email", ["email", "e-mail", "mail"]),
    ("wish", ["wunschpartner", "wunsch", "freund", "partner", "moechte mit"]),
    ("avoid", ["nicht mit", "nichtmit", "sonderwunsch", "getrennt", "avoid"]),
    ("cluster", ["chorklasse", "chor", "profil", "zweig", "blaeser", "sport", "musik"]),
    ("concentrate", ["2. fremdsprache", "2.fremdsprache", "fremdsprache", "2. fs", "2.fs", "sprache", "latein"]),
    ("spread", ["durchschnitt", "durschnitt", "schnitt", "notendurchschnitt", "note", "gpa"]),
    ("balance", ["geschlecht", "m/w", "gender", "sex"]),
    ("mix", ["grundschule", "herkunftsschule", "herkunft", "schule", "vorschule", "kita"]),
    ("note", ["bemerkung", "bemerkungen", "kommentar", "notiz", "anmerkung"]),
    ("ignore", ["anzahl", "nr", "lfd", "id"]),
]
SUBJECT_GRADES = ["deutsch", "mathe", "mathematik", "hsu", "sachunterricht", "englisch"]


def detect_role(header, sample):
    h = (header or "").strip().lower()
    if h in SUBJECT_GRADES:
        return {"role": "ignore"}
    for role, kws in ROLE_KEYWORDS:
        if any(h == kw or kw in h for kw in kws):
            if role == "cluster":
                return {"role": role, "targetValue": guess_cluster_value(sample)}
            if role == "concentrate":
                return {"role": role, "targetValue": guess_minority(sample)}
            return {"role": role}
    non_empty = [v for v in sample if v is not None and str(v).strip() != ""]
    if not non_empty:
        return {"role": "ignore"}
    numeric = [v for v in non_empty if isinstance(v, (int, float)) or _is_num(v)]
    if len(numeric) / len(non_empty) > 0.8:
        return {"role": "spread"}
    distinct = {str(v).strip().lower() for v in non_empty}
    if len(distinct) <= 5 and len(non_empty) > len(distinct):
        return {"role": "balance"}
    return {"role": "ignore"}


def _is_num(v):
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def guess_cluster_value(values):
    counts = defaultdict(int)
    for v in values:
        if v is None:
            continue
        s = str(v).strip().lower()
        if s:
            counts[s] += 1
    if "ja" in counts:
        return "ja"
    return min(counts, key=counts.get) if counts else "ja"


def guess_minority(values):
    counts = defaultdict(int)
    for v in values:
        if v is None:
            continue
        s = str(v).strip()
        if s:
            counts[s] += 1
    return min(counts, key=counts.get) if counts else ""


# --------------------------------------------------------------------------- #
#  Excel lesen
# --------------------------------------------------------------------------- #
def read_workbook(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    best = None
    best_score = -1
    for name in wb.sheetnames:
        ws = wb[name]
        grid = [list(r) for r in ws.iter_rows(values_only=True)]
        if not grid:
            continue
        header = [c for c in (grid[0] or []) if isinstance(c, str) and c.strip()]
        score = len(header) + (5 if "klasseneinteilung" in name.lower() else 0)
        if score > best_score:
            best_score = score
            best = (name, grid)
    if not best:
        sys.exit("Die Datei enthält keine lesbare Tabelle.")
    name, grid = best
    headers = [("" if c is None else str(c).strip()) for c in (grid[0] or [])]
    rows = [r for r in grid[1:] if any(c is not None and str(c).strip() != "" for c in r)]
    return name, headers, rows


def detect_columns(headers, rows):
    cols = []
    for i, header in enumerate(headers):
        if not header:
            cols.append({"header": f"Spalte {i+1}", "role": "ignore"})
            continue
        sample = [r[i] if i < len(r) else None for r in rows[:60]]
        d = detect_role(header, sample)
        cols.append({"header": header, "role": d["role"], **({"targetValue": d["targetValue"]} if d.get("targetValue") else {})})
    # Fallback: sicherstellen, dass es einen Namen gibt
    if not any(c["role"] in ("lastName", "fullName") for c in cols):
        for i, c in enumerate(cols):
            if c["role"] == "ignore" and any(isinstance(r[i] if i < len(r) else None, str) for r in rows):
                c["role"] = "fullName"
                break
    return cols


# --------------------------------------------------------------------------- #
#  Anonymisierung + Namensauflösung
# --------------------------------------------------------------------------- #
def split_mentions(text):
    parts = re.split(r"[,;/]|\bund\b|\boder\b|\+", text, flags=re.IGNORECASE)
    return [p.strip() for p in parts if len(p.strip()) >= 2]


def split_full_name(full):
    parts = full.strip().split()
    if len(parts) == 1:
        return parts[0], parts[0]
    return " ".join(parts[:-1]), parts[-1]


def build_index(entries):
    full, first, last = defaultdict(list), defaultdict(list), defaultdict(list)
    for e in entries:
        full[norm(e["firstName"] + e["lastName"])].append(e["code"])
        full[norm(e["lastName"] + e["firstName"])].append(e["code"])
        first[norm(e["firstName"])].append(e["code"])
        last[norm(e["lastName"])].append(e["code"])
    return {"full": full, "first": first, "last": last}


def resolve_name(raw, idx, self_code):
    n = norm(raw)
    if len(n) < 3:
        return None
    ex = idx["full"].get(n)
    if ex and len(ex) == 1 and ex[0] != self_code:
        return ex[0]
    parts = raw.strip().split()
    if len(parts) >= 2:
        c = idx["full"].get(norm(parts[0] + parts[-1]))
        if c and len(c) == 1 and c[0] != self_code:
            return c[0]
    for key in ("first", "last"):
        m = idx[key].get(n)
        if m and len(m) == 1 and m[0] != self_code:
            return m[0]
    best, best_d, best_c = None, 99, 0
    for key, codes in idx["full"].items():
        d = edit_distance(n, key)
        if d < best_d:
            best_d, best, best_c = d, (codes[0] if len(codes) == 1 else None), 1
        elif d == best_d:
            best_c += 1
    tol = 2 if len(n) >= 10 else 1
    if best and best != self_code and best_d <= tol and best_c == 1:
        return best
    return None


def top_candidates(raw, idx, entries, k=4):
    """Beste Namens-Kandidaten für eine unklare Nennung (für die Rückfrage)."""
    n = norm(raw)
    scored = []
    by_code = {e["code"]: e for e in entries}
    seen = set()
    for key in ("full", "first", "last"):
        for name_key, codes in idx[key].items():
            for code in codes:
                if code in seen:
                    continue
                d = edit_distance(n, name_key)
                scored.append((d, code))
                seen.add(code)
    scored.sort(key=lambda x: x[0])
    out = []
    for d, code in scored[:k]:
        e = by_code[code]
        out.append({"code": code, "name": f"{e['firstName']} {e['lastName']}".strip(), "dist": d})
    return out


def scrub_text(text, entries):
    out = text
    variants = []
    for e in entries:
        f, l = e["firstName"].strip(), e["lastName"].strip()
        if f and l:
            variants += [(f"{f} {l}", e["code"]), (f"{l} {f}", e["code"]), (f"{l}, {f}", e["code"])]
    for e in entries:
        if len(e["lastName"].strip()) > 3:
            variants.append((e["lastName"].strip(), e["code"]))
    for e in entries:
        if len(e["firstName"].strip()) > 3:
            variants.append((e["firstName"].strip(), e["code"]))
    variants.sort(key=lambda x: -len(x[0]))
    for name, code in variants:
        out = re.sub(re.escape(name), code, out, flags=re.IGNORECASE)
    out = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "[email]", out)
    out = re.sub(r"\b(S\d{3})[a-zäöüß]+", r"\1", out)
    return out


def cell(row, i):
    if i is None or i < 0 or i >= len(row):
        return ""
    v = row[i]
    return "" if v is None else str(v).strip()


def anonymize(headers, rows, cols, corrections):
    # Erste Spalte je Rolle gewinnt (z. B. Rufname vor Vornamen für Namensauflösung)
    role_idx = {}
    for i, c in enumerate(cols):
        role_idx.setdefault(c["role"], i)
    iFirst = role_idx.get("firstName", -1)
    iLast = role_idx.get("lastName", -1)
    iFull = role_idx.get("fullName", -1)
    iEmail = role_idx.get("email", -1)
    iNote = role_idx.get("note", -1)
    attr_cols = [(i, c) for i, c in enumerate(cols) if c["role"] in ("balance", "concentrate", "spread", "mix", "cluster")]
    wish_cols = [i for i, c in enumerate(cols) if c["role"] == "wish"]
    avoid_cols = [i for i, c in enumerate(cols) if c["role"] == "avoid"]

    entries = []
    for i, row in enumerate(rows):
        first = cell(row, iFirst)
        last = cell(row, iLast)
        full = cell(row, iFull)
        if full and (not first or not last):
            f, l = split_full_name(full)
            first = first or f
            last = last or l
        entries.append({"code": f"S{i+1:03d}", "firstName": first, "lastName": last, "email": cell(row, iEmail)})

    mapping = {e["code"]: {"firstName": e["firstName"], "lastName": e["lastName"],
                           "full": f"{e['firstName']} {e['lastName']}".strip(), "email": e["email"]}
               for e in entries}
    idx = build_index(entries)
    unresolved = []

    def resolve(raw, self_code):
        key = norm(raw)
        if key in corrections:
            return corrections[key] or None
        code = resolve_name(raw, idx, self_code)
        return code

    students = []
    for i, row in enumerate(rows):
        code = entries[i]["code"]
        wishes_raw, wishes, offene_w = [], [], []
        for ci in wish_cols:
            val = cell(row, ci)
            if not val:
                continue
            for m in split_mentions(val):
                wishes_raw.append(m)
                r = resolve(m, code)
                if r and r != code and r not in wishes:
                    wishes.append(r)
                elif not r:
                    offene_w.append(m)
                    unresolved.append({"code": code, "field": "wish", "mention": m,
                                       "candidates": top_candidates(m, idx, entries)})
        avoid_raw, avoid, offene_a = [], [], []
        for ci in avoid_cols:
            val = cell(row, ci)
            if not val:
                continue
            for m in split_mentions(val):
                avoid_raw.append(m)
                r = resolve(m, code)
                if r and r != code and r not in avoid:
                    avoid.append(r)
                elif not r:
                    offene_a.append(m)
                    unresolved.append({"code": code, "field": "avoid", "mention": m,
                                       "candidates": top_candidates(m, idx, entries)})
        attrs = {}
        for ci, c in attr_cols:
            raw = row[ci] if ci < len(row) else None
            if c["role"] == "spread":
                attrs[c["header"]] = float(raw) if isinstance(raw, (int, float)) else (float(raw) if _is_num(raw) else None)
            else:
                attrs[c["header"]] = str(raw).strip() if raw is not None else None
        note = scrub_text(cell(row, iNote), entries) if iNote >= 0 and cell(row, iNote) else None
        students.append({"code": code, "wishesRaw": wishes_raw, "avoidRaw": avoid_raw,
                         "wishes": wishes, "avoid": avoid, "offeneWuensche": offene_w,
                         "offeneAvoid": offene_a, "attrs": attrs, "note": note})
    return students, mapping, unresolved


# --------------------------------------------------------------------------- #
#  Config aus Spalten ableiten
# --------------------------------------------------------------------------- #
KIND_WEIGHT = {"avoid": 100, "wish": 90, "balance": 70, "mix": 65, "concentrate": 55, "spread": 45}


def build_config(cols, students, num_classes):
    crit, clusters = [], []

    def mk(kind, header=None, hard=False, target=None):
        c = str(header or "")
        label = {
            "wish": "Wunschpartner erfüllen", "avoid": "Sonderwünsche „nicht mit …“",
            "balance": f"{c} gleichmäßig verteilen", "concentrate": f"{c} auf wenige Klassen bündeln",
            "spread": f"{c} heterogen verteilen", "mix": f"{c} mischen (Blöcke begrenzen)",
        }[kind]
        return {"id": f"{kind}:{header or ''}", "kind": kind, "header": header, "label": label,
                "enabled": True, "hard": hard, "weight": KIND_WEIGHT[kind],
                "targetValue": target, "maxBlock": 8 if kind == "mix" else None}

    if any(c["role"] == "avoid" for c in cols):
        crit.append(mk("avoid", hard=True))
    if any(c["role"] == "wish" for c in cols):
        crit.append(mk("wish"))
    for c in cols:
        if c["role"] == "balance":
            crit.append(mk("balance", c["header"]))
        if c["role"] == "spread":
            crit.append(mk("spread", c["header"]))
        if c["role"] == "mix":
            crit.append(mk("mix", c["header"]))
        if c["role"] == "concentrate":
            crit.append(mk("concentrate", c["header"], target=c.get("targetValue") or _minority(students, c["header"])))
        if c["role"] == "cluster":
            clusters.append({"header": c["header"], "value": c.get("targetValue") or "ja",
                             "label": c["header"], "classes": None})
    crit.sort(key=lambda c: -c["weight"])
    return {"numClasses": num_classes, "classPrefix": "5", "balanceSizes": True,
            "columns": cols, "clusters": clusters, "criteria": crit,
            "extraRules": [], "corrections": {}}


def _minority(students, header):
    counts = defaultdict(int)
    for s in students:
        v = s["attrs"].get(header)
        if v not in (None, ""):
            counts[str(v).strip()] += 1
    return min(counts, key=counts.get) if counts else ""


# --------------------------------------------------------------------------- #
#  Solver
# --------------------------------------------------------------------------- #
def _std(vals):
    if not vals:
        return 0.0
    avg = sum(vals) / len(vals)
    return (sum((v - avg) ** 2 for v in vals) / len(vals)) ** 0.5


def _attr_str(s, header):
    v = s["attrs"].get(header)
    return None if v in (None, "") else str(v).strip()


class Solver:
    def __init__(self, students, config):
        self.students = {s["code"]: s for s in students}
        self.slist = students
        self.config = config
        self.K = config["numClasses"]
        n = len(students)
        self.maxSize = -(-n // self.K) if config.get("balanceSizes", True) else n
        self.targetSize = n / self.K
        self.criteria = [c for c in config["criteria"] if c.get("enabled", True)]
        self.hardAvoid = any(c["kind"] == "avoid" and c.get("hard") for c in self.criteria)

        # Cluster-Kinder fixieren
        self.clusterOf = {}
        self.clusterClasses = set()
        nxt = 0
        for cl in config["clusters"]:
            members = [s for s in students if (_attr_str(s, cl["header"]) or "").lower() == cl["value"].lower()]
            if not members:
                continue
            need = cl["classes"] or max(1, -(-len(members) // self.maxSize))
            cls = []
            for _ in range(need):
                if nxt >= self.K:
                    break
                cls.append(nxt)
                self.clusterClasses.add(nxt)
                nxt += 1
            if not cls:
                continue
            for i, s in enumerate(members):
                self.clusterOf[s["code"]] = cls[i % len(cls)]

        self.notWith = self._collect_notwith()
        self.units = self._build_units()
        self._precompute()

    def _collect_notwith(self):
        seen, pairs = set(), []
        def add(a, b):
            key = tuple(sorted((a, b)))
            if key not in seen:
                seen.add(key)
                pairs.append((a, b))
        for s in self.slist:
            for o in s["avoid"]:
                add(s["code"], o)
        for r in self.config.get("extraRules", []):
            if r["type"] == "notWith" and len(r["codes"]) == 2:
                add(r["codes"][0], r["codes"][1])
        return pairs

    def _build_units(self):
        cap = 4
        wishes_on = any(c["kind"] == "wish" and c.get("enabled", True) for c in self.config["criteria"])
        free = [s for s in self.slist if s["code"] not in self.clusterOf]
        by = {s["code"]: s for s in free}
        parent = {s["code"]: s["code"] for s in free}
        size = {s["code"]: 1 for s in free}
        nw = {tuple(sorted((s["code"], o))) for s in self.slist for o in s["avoid"]}
        for r in self.config.get("extraRules", []):
            if r["type"] == "notWith" and len(r["codes"]) == 2:
                nw.add(tuple(sorted(r["codes"])))

        def find(x):
            root = x
            while parent[root] != root:
                root = parent[root]
            while parent[x] != root:
                parent[x], x = root, parent[x]
            return root

        def conflict_free(ra, rb):
            a = [s["code"] for s in free if find(s["code"]) == ra]
            b = [s["code"] for s in free if find(s["code"]) == rb]
            return not any(tuple(sorted((x, y))) in nw for x in a for y in b)

        def union(a, b, maxg):
            if a not in by or b not in by:
                return
            ra, rb = find(a), find(b)
            if ra == rb or size[ra] + size[rb] > min(maxg, self.maxSize):
                return
            if not conflict_free(ra, rb):
                return
            parent[rb] = ra
            size[ra] += size[rb]

        for r in self.config.get("extraRules", []):
            if r["type"] == "mustWith":
                for i in range(1, len(r["codes"])):
                    union(r["codes"][0], r["codes"][i], max(cap, len(r["codes"])))
        if wishes_on:
            for s in free:
                for w in s["wishes"]:
                    if w in by and s["code"] in by[w]["wishes"]:
                        union(s["code"], w, cap)
            for s in free:
                if s["wishes"]:
                    union(s["code"], s["wishes"][0], cap)
            for s in free:
                for w in s["wishes"][1:]:
                    union(s["code"], w, cap)

        groups = defaultdict(list)
        for s in free:
            groups[find(s["code"])].append(s["code"])
        units = [{"members": m, "fixed": None} for m in groups.values()]
        for code, k in self.clusterOf.items():
            units.append({"members": [code], "fixed": k})
        return units

    def _precompute(self):
        self.balanceRatios, self.spreadStats, self.smallGroups, self.concentrateMin = {}, {}, {}, {}
        for c in self.criteria:
            h = c.get("header")
            if c["kind"] == "balance" and h:
                counts, total = defaultdict(int), 0
                for s in self.slist:
                    v = _attr_str(s, h)
                    if v is not None:
                        counts[v] += 1
                        total += 1
                self.balanceRatios[h] = {v: (cnt / total if total else 0) for v, cnt in counts.items()}
            if c["kind"] == "spread" and h:
                vals = [s["attrs"][h] for s in self.slist if isinstance(s["attrs"].get(h), (int, float))]
                self.spreadStats[h] = {"avg": (sum(vals) / len(vals) if vals else 0), "std": _std(vals)}
            if c["kind"] == "mix" and h:
                groups = defaultdict(list)
                for s in self.slist:
                    v = _attr_str(s, h)
                    if v:
                        groups[v].append(s["code"])
                self.smallGroups[h] = [g for g in groups.values() if 2 <= len(g) <= 4]
            if c["kind"] == "concentrate" and h and c.get("targetValue"):
                cnt = sum(1 for s in self.slist if (_attr_str(s, h) or "") == c["targetValue"])
                self.concentrateMin[c["id"]] = max(1, -(-cnt // self.maxSize))

    def evaluate(self, class_of):
        K = self.K
        p = {}
        sizes = [0] * K
        for k in class_of.values():
            sizes[k] += 1
        for c in self.criteria:
            w = c["weight"] / 100
            kind, h = c["kind"], c.get("header")
            if kind == "wish":
                unfulfilled = 0
                for s in self.slist:
                    if not s["wishes"]:
                        continue
                    k = class_of.get(s["code"])
                    if k is None:
                        continue
                    if k in self.clusterClasses and s["code"] in self.clusterOf:
                        continue
                    if not any(class_of.get(x) == k for x in s["wishes"]):
                        unfulfilled += 1
                p[c["id"]] = unfulfilled * 25 * w
            elif kind == "avoid":
                v = sum(1 for a, b in self.notWith
                        if a in class_of and b in class_of and class_of[a] == class_of[b])
                p[c["id"]] = v * (5000 if c.get("hard") else 200) * w
            elif kind == "balance" and h:
                ratios = self.balanceRatios[h]
                known = [0] * K
                counts = defaultdict(lambda: [0] * K)
                for code, k in class_of.items():
                    val = _attr_str(self.students[code], h)
                    if val is None:
                        continue
                    known[k] += 1
                    counts[val][k] += 1
                dev = 0
                for val, ratio in ratios.items():
                    for k in range(K):
                        dev += abs(counts[val][k] - ratio * known[k])
                p[c["id"]] = dev * 6 * w
            elif kind == "concentrate" and h and c.get("targetValue"):
                counts = [0] * K
                for code, k in class_of.items():
                    if (_attr_str(self.students[code], h) or "") == c["targetValue"]:
                        counts[k] += 1
                sc = sorted(counts, reverse=True)
                mn = self.concentrateMin.get(c["id"], 1)
                outside = sum(sc[mn:])
                withv = sum(1 for x in counts if x > 0)
                p[c["id"]] = (outside * 8 + max(0, withv - mn) * 15) * w
            elif kind == "spread" and h:
                st = self.spreadStats[h]
                lists = [[] for _ in range(K)]
                for code, k in class_of.items():
                    v = self.students[code]["attrs"].get(h)
                    if isinstance(v, (int, float)):
                        lists[k].append(v)
                dev = 0
                for lst in lists:
                    if not lst:
                        continue
                    avg = sum(lst) / len(lst)
                    dev += abs(avg - st["avg"]) * 10 + abs(_std(lst) - st["std"]) * 6
                p[c["id"]] = dev * w
            elif kind == "mix" and h:
                mb = c.get("maxBlock", 8) or 8
                per = [defaultdict(int) for _ in range(K)]
                for code, k in class_of.items():
                    v = _attr_str(self.students[code], h)
                    if v:
                        per[k][v] += 1
                blocks = sum(max(0, cnt - mb) for k in range(K) for cnt in per[k].values())
                split = sum(len({class_of.get(x) for x in g}) - 1 for g in self.smallGroups[h])
                p[c["id"]] = (blocks * 40 + split * 12) * w
        if self.config.get("balanceSizes", True):
            p["_size"] = sum(max(0, abs(s - self.targetSize) - 1) for s in sizes) * 30
        return sum(p.values()), p

    def solve(self, seed=42):
        rnd = random.Random(seed)
        units = self.units
        K = self.K
        unit_class = [-1] * len(units)
        class_of = {}
        sizes = [0] * K

        def place(ui, k):
            prev = unit_class[ui]
            if prev >= 0:
                sizes[prev] -= len(units[ui]["members"])
            unit_class[ui] = k
            sizes[k] += len(units[ui]["members"])
            for m in units[ui]["members"]:
                class_of[m] = k

        def avoid_conflict(ui, k):
            if not self.hardAvoid:
                return False
            mem = set(units[ui]["members"])
            for a, b in self.notWith:
                if a in mem and class_of.get(b) == k and unit_class[ui] != k:
                    return True
                if b in mem and class_of.get(a) == k and unit_class[ui] != k:
                    return True
            return False

        for ui, u in enumerate(units):
            if u["fixed"] is not None:
                place(ui, min(u["fixed"], K - 1))

        free = sorted([ui for ui, u in enumerate(units) if u["fixed"] is None],
                      key=lambda ui: -len(units[ui]["members"]))
        for ui in free:
            s = len(units[ui]["members"])
            bestK, best = -1, float("inf")
            for k in range(K):
                if sizes[k] + s > self.maxSize or avoid_conflict(ui, k):
                    continue
                place(ui, k)
                score, _ = self.evaluate(class_of)
                adj = score + sizes[k] * 0.01
                if adj < best:
                    best, bestK = adj, k
            if bestK < 0:
                bestK = min(range(K), key=lambda k: sizes[k])
            place(ui, bestK)

        cur, _ = self.evaluate(class_of)
        iters = min(20000, 3000 + len(self.slist) * 120)
        for _ in range(iters):
            if not free:
                break
            if rnd.random() < 0.5:
                ui = free[rnd.randrange(len(free))]
                frm = unit_class[ui]
                to = rnd.randrange(K)
                if to == frm or sizes[to] + len(units[ui]["members"]) > self.maxSize or avoid_conflict(ui, to):
                    continue
                place(ui, to)
                score, _ = self.evaluate(class_of)
                if score < cur:
                    cur = score
                else:
                    place(ui, frm)
            else:
                a = free[rnd.randrange(len(free))]
                b = free[rnd.randrange(len(free))]
                if a == b or unit_class[a] == unit_class[b]:
                    continue
                ka, kb = unit_class[a], unit_class[b]
                sa, sb = len(units[a]["members"]), len(units[b]["members"])
                if sizes[ka] - sa + sb > self.maxSize or sizes[kb] - sb + sa > self.maxSize:
                    continue
                place(a, kb)
                place(b, ka)
                if avoid_conflict(a, kb) or avoid_conflict(b, ka):
                    place(a, ka)
                    place(b, kb)
                    continue
                score, _ = self.evaluate(class_of)
                if score < cur:
                    cur = score
                else:
                    place(a, ka)
                    place(b, kb)

        score, penalties = self.evaluate(class_of)
        return {"classOf": dict(class_of), "score": score, "penalties": penalties,
                "hardViolations": self._check_hard(class_of)}

    def _check_hard(self, class_of):
        out = []
        sizes = [0] * self.K
        for k in class_of.values():
            sizes[k] += 1
        if self.config.get("balanceSizes", True) and max(sizes) - min(sizes) > 1:
            out.append(f"Klassengrößen weichen ab: {sizes}")
        if self.hardAvoid:
            for a, b in self.notWith:
                if class_of[a] == class_of[b]:
                    out.append(f"„nicht mit“ verletzt: {a}+{b}")
        for code, k in self.clusterOf.items():
            if class_of[code] not in self.clusterClasses:
                out.append(f"Cluster-Kind {code} nicht in Cluster-Klasse")
        return out

    def solve_best(self, restarts=4, base_seed=1):
        best = None
        for r in range(restarts):
            a = self.solve(base_seed + r * 7919)
            if (best is None or len(a["hardViolations"]) < len(best["hardViolations"])
                    or (len(a["hardViolations"]) == len(best["hardViolations"]) and a["score"] < best["score"])):
                best = a
        return best


def class_stats(students, config, assignment):
    K = config["numClasses"]
    crit = [c for c in config["criteria"] if c.get("enabled", True)]
    by = {s["code"]: s for s in students}
    cluster_classes = set()
    for cl in config["clusters"]:
        for s in students:
            if (str(s["attrs"].get(cl["header"]) or "")).lower() == cl["value"].lower():
                k = assignment["classOf"].get(s["code"])
                if k is not None:
                    cluster_classes.add(k)
    balance_h = [c["header"] for c in crit if c["kind"] == "balance"]
    mix_h = [c["header"] for c in crit if c["kind"] == "mix"]
    spread_h = [c["header"] for c in crit if c["kind"] == "spread"]
    conc = [c for c in crit if c["kind"] == "concentrate"]
    out = []
    for k in range(K):
        members = [s for s in students if assignment["classOf"].get(s["code"]) == k]
        st = {"class": k, "size": len(members), "isCluster": k in cluster_classes,
              "categories": {}, "spreads": {}, "mixes": {}, "concentrates": {},
              "unfulfilledWishes": [], "avoidViolations": []}
        for h in balance_h + mix_h:
            cnt = defaultdict(int)
            for s in members:
                v = _attr_str(s, h)
                if v:
                    cnt[v] += 1
            tgt = st["categories"] if h in balance_h else st["mixes"]
            tgt[h] = sorted(cnt.items(), key=lambda x: -x[1])
        for h in spread_h:
            vals = [s["attrs"][h] for s in members if isinstance(s["attrs"].get(h), (int, float))]
            st["spreads"][h] = round(sum(vals) / len(vals), 2) if vals else None
        for c in conc:
            st["concentrates"][c["header"]] = sum(1 for s in members if (_attr_str(s, c["header"]) or "") == c["targetValue"])
        for s in members:
            is_cl = any((str(s["attrs"].get(cl["header"]) or "")).lower() == cl["value"].lower() for cl in config["clusters"])
            if s["wishes"] and not is_cl and not any(assignment["classOf"].get(w) == k for w in s["wishes"]):
                st["unfulfilledWishes"].append(s["code"])
            for o in s["avoid"]:
                if assignment["classOf"].get(o) == k and s["code"] < o:
                    st["avoidViolations"].append([s["code"], o])
        out.append(st)
    return out


# --------------------------------------------------------------------------- #
#  CLI
# --------------------------------------------------------------------------- #
def label(prefix, k):
    return f"{prefix}{chr(97 + k)}"


def load(work, name):
    with open(os.path.join(work, name), encoding="utf-8") as f:
        return json.load(f)


def save(work, name, data):
    os.makedirs(work, exist_ok=True)
    with open(os.path.join(work, name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def cmd_prep(args):
    name, headers, rows = read_workbook(args.file)
    cfg_path = os.path.join(args.work, "config.json")
    if args.config and os.path.exists(args.config):
        config = json.load(open(args.config, encoding="utf-8"))
        cols = config["columns"]
        corrections = config.get("corrections", {})
    elif os.path.exists(cfg_path):
        config = load(args.work, "config.json")
        cols = config["columns"]
        corrections = config.get("corrections", {})
    else:
        config = None
        cols = detect_columns(headers, rows)
        corrections = {}

    students, mapping, unresolved = anonymize(headers, rows, cols, corrections)
    os.makedirs(args.work, exist_ok=True)
    save(args.work, "mapping.json", mapping)
    save(args.work, "students.json", students)
    save(args.work, "unresolved.json", unresolved)
    if config is None:
        num = max(2, round(len(students) / 25))
        config = build_config(cols, students, num)
        save(args.work, "config.json", config)
    else:
        config["columns"] = cols
        config["corrections"] = corrections
        save(args.work, "config.json", config)

    print(f"Blatt: {name}  ·  {len(students)} Schüler anonymisiert (S001–S{len(students):03d})")
    print("\nErkannte Spalten:")
    for c in cols:
        if c["role"] != "ignore":
            print(f"  • {c['header']}  →  {c['role']}" + (f" ({c.get('targetValue')})" if c.get('targetValue') else ""))
    resolved = sum(len(s["wishes"]) for s in students)
    print(f"\nWünsche aufgelöst: {resolved}   ·   offen/unklar: {len(unresolved)}")
    if unresolved:
        print("\nOffene Nennungen (bitte im Dialog klären) — jeweils mit besten Kandidaten:")
        for u in unresolved[:40]:
            who = mapping[u["code"]]["full"]
            cand = ", ".join(f"{c['name']} [{c['code']}]" for c in u["candidates"][:3])
            print(f"  {u['code']} ({who}) {('Wunsch' if u['field']=='wish' else 'nicht mit')} „{u['mention']}“  →  {cand}")
        if len(unresolved) > 40:
            print(f"  … und {len(unresolved) - 40} weitere.")
    notes = [(s["code"], s["note"]) for s in students if s["note"]]
    if notes:
        print(f"\nBemerkungen ({len(notes)}):")
        for code, n in notes[:30]:
            print(f"  {code}: {n}")
    print(f"\nArbeitsdateien in {args.work}/  (config.json bearbeiten, dann 'solve').")


def cmd_solve(args):
    students = load(args.work, "students.json")
    config = load(args.work, "config.json")
    solver = Solver(students, config)
    assignment = solver.solve_best(restarts=args.restarts, base_seed=args.seed)
    stats = class_stats(students, config, assignment)
    assignment["stats"] = stats
    save(args.work, "assignment.json", assignment)
    mapping = load(args.work, "mapping.json")

    print(f"Einteilung berechnet  ·  Score {assignment['score']:.1f}  ·  "
          f"harte Verletzungen: {len(assignment['hardViolations'])}")
    if assignment["hardViolations"]:
        for v in assignment["hardViolations"][:6]:
            print("  ⚠️ " + v)
    print()
    for st in stats:
        tag = " [CHOR/CLUSTER]" if st["isCluster"] else ""
        cats = " ".join(f"{h}:{dict(v)}" for h, v in st["categories"].items())
        conc = " ".join(f"{h}={n}" for h, n in st["concentrates"].items())
        sp = " ".join(f"Ø{h}={a}" for h, a in st["spreads"].items())
        print(f"  Klasse {label(config['classPrefix'], st['class'])}{tag}: {st['size']} SuS  {cats}  {conc}  {sp}  "
              f"offene Wünsche: {len(st['unfulfilledWishes'])}")
    tot_unf = sum(len(s["unfulfilledWishes"]) for s in stats)
    tot_w = sum(1 for s in students if s["wishes"])
    print(f"\nWunsch-Kinder mit erfülltem Wunsch: {tot_w - tot_unf}/{tot_w}")
    # Namen der unerfüllten Wünsche (zum gezielten Nachbessern)
    unhappy = [c for st in stats for c in st["unfulfilledWishes"]]
    if unhappy:
        print("Ohne Wunschpartner: " + ", ".join(f"{c} ({mapping[c]['full']})" for c in unhappy[:20]))


def cmd_export(args):
    students = load(args.work, "students.json")
    config = load(args.work, "config.json")
    assignment = load(args.work, "assignment.json")
    mapping = load(args.work, "mapping.json")
    out = args.out or os.path.join(args.work, "Klasseneinteilung.xlsx")

    def deanon(t):
        return re.sub(r"S\d{3}", lambda m: mapping.get(m.group(0), {}).get("full", m.group(0)), t or "")

    attr_headers = [c["header"] for c in config["columns"]
                    if c["role"] in ("balance", "concentrate", "spread", "mix", "cluster")]
    rows = []
    for s in students:
        idn = mapping.get(s["code"], {})
        k = assignment["classOf"].get(s["code"])
        row = {"Klasse": label(config["classPrefix"], k) if k is not None else "?",
               "Nachname": idn.get("lastName", "?"), "Vorname": idn.get("firstName", "?")}
        if idn.get("email"):
            row["Email"] = idn["email"]
        for h in attr_headers:
            v = s["attrs"].get(h)
            row[h] = "" if v is None else v
        row["Wunschpartner"] = deanon(", ".join(s["wishes"]) + (f" | offen: {', '.join(s['offeneWuensche'])}" if s["offeneWuensche"] else ""))
        row["nicht mit"] = deanon(", ".join(s["avoid"]) + (f" | offen: {', '.join(s['offeneAvoid'])}" if s["offeneAvoid"] else ""))
        if s["note"]:
            row["Bemerkung"] = deanon(s["note"])
        rows.append(row)
    rows.sort(key=lambda r: (str(r["Klasse"]), str(r["Nachname"])))

    wb = openpyxl.Workbook()
    stats = assignment.get("stats") or class_stats(students, config, assignment)

    def write_sheet(ws, data):
        if not data:
            return
        cols = list({k: None for row in data for k in row})
        ws.append(cols)
        for row in data:
            ws.append([row.get(c, "") for c in cols])

    ws = wb.active
    ws.title = "Klasseneinteilung"
    write_sheet(ws, rows)
    for k in range(config["numClasses"]):
        lbl = label(config["classPrefix"], k)
        write_sheet(wb.create_sheet(f"Klasse {lbl}"), [r for r in rows if r["Klasse"] == lbl])
    stat_rows = []
    for st in stats:
        r = {"Klasse": label(config["classPrefix"], st["class"]), "Schüler": st["size"]}
        if st["isCluster"]:
            r["Cluster"] = "ja"
        for h, cats in st["categories"].items():
            r[h] = ", ".join(f"{v}: {c}" for v, c in cats)
        for h, n in st["concentrates"].items():
            r[f"{h} (Zielwert)"] = n
        for h, a in st["spreads"].items():
            r[f"Ø {h}"] = a if a is not None else ""
        for h, m in st["mixes"].items():
            r[h] = ", ".join(f"{v}: {c}" for v, c in m)
        r["Unerfüllte Wünsche"] = len(st["unfulfilledWishes"])
        stat_rows.append(r)
    write_sheet(wb.create_sheet("Statistik"), stat_rows)
    wb.save(out)
    print(f"Fertige Einteilung gespeichert: {out}")
    print(f"  Blätter: Klasseneinteilung (Gesamtliste), je 1 pro Klasse, Statistik")


def main():
    ap = argparse.ArgumentParser(description="Klasseneinteilung-Engine")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("prep")
    p1.add_argument("file")
    p1.add_argument("--work", default="ke_arbeit")
    p1.add_argument("--config", default=None)
    p1.set_defaults(func=cmd_prep)
    p2 = sub.add_parser("solve")
    p2.add_argument("--work", default="ke_arbeit")
    p2.add_argument("--seed", type=int, default=1)
    p2.add_argument("--restarts", type=int, default=4)
    p2.set_defaults(func=cmd_solve)
    p3 = sub.add_parser("export")
    p3.add_argument("--work", default="ke_arbeit")
    p3.add_argument("--out", default=None)
    p3.set_defaults(func=cmd_export)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
