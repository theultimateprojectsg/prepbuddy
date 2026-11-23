"""Admin tool: grow the library's question banks so every chapter has a full, checked set of questions.

    ADMIN_PASSWORD=... python3 tools/build_bank.py --book pb-p4-science            # one book
    ADMIN_PASSWORD=... python3 tools/build_bank.py --book all                      # every book in the library
    python3 tools/build_bank.py --book all --dry-run                               # just show what's missing

It asks the live site to write the questions (the same writer and checker the app uses, so they look and mark
exactly like the app's own), keeps only the ones that pass the check, and saves them into
library/<book>/questions.json after each chapter (so it can be stopped and run again: it only fills what's
missing). Families get the new questions automatically the next time their book syncs.

Target per chapter (default 60, scale with --per):
  multiple-choice  level 1: 10   level 2: 14   level 3: 12   level 4: 8
  written          level 2: 4 (short)   level 3: 6 (structured)   level 4: 6 (structured)

A review file listing every new question is written to /tmp/prepbuddy-bank-review-<book>.md for spot-checking.
The admin password is read from the environment and never printed or saved.
"""
import argparse, json, os, random, re, string, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIX = {('mcq', 1): 10, ('mcq', 2): 14, ('mcq', 3): 12, ('mcq', 4): 8,
       ('short', 2): 4, ('structured', 3): 6, ('structured', 4): 6}   # adds up to 60
WRITTEN = {'short', 'structured', 'essay'}

ap = argparse.ArgumentParser()
ap.add_argument('--book', required=True, help="a library book id (e.g. pb-p4-science), or 'all'")
ap.add_argument('--unit', help='only this chapter id (e.g. u3)')
ap.add_argument('--per', type=int, default=60, help='questions per chapter (default 60)')
ap.add_argument('--site', default='https://prepbuddy.givingtree.sg')
ap.add_argument('--dry-run', action='store_true', help="only show what's missing")
ap.add_argument('--max-calls', type=int, default=2000, help='stop after this many writer calls (safety)')
a = ap.parse_args()

pw = os.environ.get('ADMIN_PASSWORD', '')
if not pw and not a.dry_run:
    sys.exit('Set ADMIN_PASSWORD in the environment first (it is never printed).')

catalog = json.load(open(os.path.join(ROOT, 'library', 'catalog.json'), encoding='utf-8'))
books = catalog if a.book == 'all' else [b for b in catalog if b['id'] == a.book]
if not books:
    sys.exit(f"No book '{a.book}' in library/catalog.json")

scale = a.per / 60
target = {k: max(1, round(v * scale)) for k, v in MIX.items()}
calls = 0


def post(path, body):
    global calls
    req = urllib.request.Request(a.site.rstrip('/') + path, data=json.dumps(body).encode('utf-8'),
                                 headers={'content-type': 'application/json', 'x-admin-password': pw})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            msg = e.read().decode('utf-8', 'replace')[:200]
            if e.code in (401, 403):
                sys.exit('The site refused the admin password.')
            if e.code == 429 or e.code >= 500:
                time.sleep(5 * (attempt + 1)); continue
            print(f'   ! {path} {e.code}: {msg}'); return None
        except Exception as e:  # network hiccup
            time.sleep(5 * (attempt + 1))
    print(f'   ! {path} failed after retries'); return None


def kind_of(q):
    t = q.get('type', 'mcq')
    return 'mcq' if t in ('mcq', 'graph') else ('short' if t == 'short' else 'structured')


def lang_of(text):
    return 'zh' if re.search(r'[㐀-鿿]', text[:2000]) else 'en'


def new_id(unit_id, taken):
    while True:
        i = 'g' + unit_id + ''.join(random.choices(string.ascii_lowercase + string.digits, k=5))
        if i not in taken:
            taken.add(i); return i


for book in books:
    folder = os.path.join(ROOT, 'library', book['id'])
    qpath = os.path.join(folder, 'questions.json')
    bank = json.load(open(qpath, encoding='utf-8')) if os.path.exists(qpath) else {}
    review = [f"# New questions for {book['title']}\n"]
    print(f"\n{book['title']} ({book['id']})")
    for u in book['units']:
        if a.unit and u['id'] != a.unit:
            continue
        tpath = os.path.join(folder, u['id'] + '.txt')
        if not os.path.exists(tpath):
            print(f"  {u['id']}: no chapter text, skipped"); continue
        text = open(tpath, encoding='utf-8').read()
        qs = bank.setdefault(u['id'], [])
        have = {}
        for q in qs:
            k = (kind_of(q), max(1, min(4, int(q.get('level') or 2))))
            have[k] = have.get(k, 0) + 1
        need = [(k, target[k] - have.get(k, 0)) for k in target if target[k] - have.get(k, 0) > 0]
        missing = sum(n for _, n in need)
        print(f"  {u['id']} {u['title'][:50]}: has {len(qs)}, needs {missing} more"
              + ('' if not missing else ' (' + ', '.join(f'{k[0]} L{k[1]}: {n}' for k, n in need) + ')'))
        if a.dry_run or not missing:
            continue
        taken = {q['id'] for q in qs}
        wanted = [{'level': k[1], 'type': k[0]} for k, n in need for _ in range(n)]
        added = 0
        review.append(f"\n## {u['id']} · {u['title']}\n")
        for i in range(0, len(wanted), 4):
            if calls >= a.max_calls:
                print('  Stopping: --max-calls reached.'); break
            items = wanted[i:i + 4]
            avoid = [(q.get('stem', '') + ' ' + ' '.join(p.get('prompt', '') for p in q.get('parts', []) or []))[:200] for q in qs][-40:]
            body = {'title': u['title'], 'text': text, 'items': items, 'avoid': avoid, 'focus': {'part': (i // 4) % 3 + 1, 'of': 3},
                    'kind': book.get('kind', ''), 'bookLevel': book.get('level', ''), 'lang': book.get('lang') or lang_of(text)}
            calls += 1
            gen = post('/api/generate', body)
            for q in (gen or {}).get('questions', []) or []:
                if q.get('figure'):
                    continue  # diagram questions need the page pictures: the app makes those itself
                v = post('/api/verify', {'title': u['title'], 'text': text, 'question': q})
                if not v or not v.get('passed'):
                    continue
                q = {k: v2 for k, v2 in q.items() if k not in ('usage', 'figure')}
                q['id'] = new_id(u['id'], taken)
                q['checked'] = 'ai'
                qs.append(q); added += 1
                review.append(f"- **L{q.get('level')} {q.get('type')}** {q.get('stem', '')[:300]}"
                              + (f"  \n  Options: {' | '.join(q.get('options') or [])} · answer {q.get('correct_option', '')}" if q.get('options') else '')
                              + '\n')
            print(f"    {added}/{missing} added", end='\r')
        print(f"    {added} added, chapter now has {len(qs)}          ")
        json.dump(bank, open(qpath, 'w', encoding='utf-8'), ensure_ascii=False)  # saved after every chapter
    if not a.dry_run:
        for b in catalog:
            if b['id'] == book['id']:
                b['questionCount'] = sum(len(v) for v in bank.values())
        json.dump(catalog, open(os.path.join(ROOT, 'library', 'catalog.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        rp = f"/tmp/prepbuddy-bank-review-{book['id']}.md"
        open(rp, 'w', encoding='utf-8').write(''.join(review))
        print(f"  Review file: {rp}")

print(f"\nDone. Writer calls: {calls}. Commit library/ to publish the new questions.")
