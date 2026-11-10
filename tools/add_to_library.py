"""Admin tool (simulation of the future admin page): add a processed book to the website's library.

    python tools/add_to_library.py BOOK.json --id bio2e --code BIO-2E7K --title "..." --subject Biology \
        --level "S4-S6 (HKDSE)" --publisher OpenStax --licence "CC BY-NC-SA 4.0" [--questions questions.json]

BOOK.json is the output of js/book.js readBook(): {pageCount, method, units:[{title,startPage,endPage,text}]}.
questions.json (optional) is a list of questions with a "section" equal to a unit title.
"""
import argparse, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('book'); ap.add_argument('--id', required=True); ap.add_argument('--code', required=True)
ap.add_argument('--title', required=True); ap.add_argument('--subject', required=True); ap.add_argument('--level', default='')
ap.add_argument('--publisher', default=''); ap.add_argument('--licence', default=''); ap.add_argument('--credit', default='')
ap.add_argument('--questions')
a = ap.parse_args()

book = json.load(open(a.book, encoding='utf-8'))
folder = os.path.join(ROOT, 'library', a.id); os.makedirs(folder, exist_ok=True)
units = []
for i, u in enumerate(book['units']):
    uid = f'u{i}'
    open(os.path.join(folder, uid + '.txt'), 'w', encoding='utf-8').write(u['text'])
    units.append({'id': uid, 'title': u['title'], 'chapter': u.get('chapter'), 'startPage': u['startPage'], 'endPage': u['endPage']})

bank = {}
if a.questions:
    by_title = {u['title']: u['id'] for u in units}
    for q in json.load(open(a.questions, encoding='utf-8')):
        uid = by_title.get(q.get('section'))
        if not uid: continue
        q = {k: v for k, v in q.items() if k not in ('origin', 'demo')}
        bank.setdefault(uid, []).append(q)
json.dump(bank, open(os.path.join(folder, 'questions.json'), 'w', encoding='utf-8'), ensure_ascii=False)

cat_path = os.path.join(ROOT, 'library', 'catalog.json')
catalog = json.load(open(cat_path, encoding='utf-8')) if os.path.exists(cat_path) else []
catalog = [b for b in catalog if b['id'] != a.id]
catalog.append({'id': a.id, 'code': a.code.upper(), 'title': a.title, 'subject': a.subject, 'level': a.level,
                'publisher': a.publisher, 'licence': a.licence, 'credit': a.credit, 'pageCount': book.get('pageCount'),
                'units': units, 'questionCount': sum(len(v) for v in bank.values())})
json.dump(catalog, open(cat_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"{a.title}: {len(units)} chapters, {sum(len(v) for v in bank.values())} ready questions, code {a.code.upper()}")
