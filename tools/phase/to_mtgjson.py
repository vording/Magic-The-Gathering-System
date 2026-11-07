#!/usr/bin/env python3
"""data/oldframe-modern.json（このアプリのカード一覧）を、phase.rs の oracle-gen が読む MTGJSON の AtomicCards 形式に変換する。

使い方: python3 tools/phase/to_mtgjson.py <出力するデータのフォルダ>
  → <フォルダ>/mtgjson/AtomicCards.json（と空の sets/）を作る
2つに分かれたカード（A // B）は今のところ変換しない。
"""
import json, os, re, sys

out_dir = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
cards = json.load(open(os.path.join(here, '..', '..', 'data', 'oldframe-modern.json')))['cards']
SUPER = {'Basic', 'Legendary', 'Snow', 'World', 'Ongoing'}
out, skipped = {}, []
for c in cards:
    tl = c.get('typeLine') or ''
    if '//' in tl:
        skipped.append(c['name'])
        continue
    left, _, right = tl.partition('—')
    words = left.split()
    mc = c.get('manaCost') or ''
    colors = c.get('colors') or []
    card = {
        'name': c['name'], 'manaCost': mc or None, 'manaValue': float(c.get('cmc') or 0), 'colors': colors,
        'colorIdentity': sorted((set(colors) | set(re.findall(r'[WUBRG]', mc + ' ' + (c.get('oracleText') or '')))) & set('WUBRG')),
        'type': tl, 'types': [w for w in words if w not in SUPER], 'subtypes': right.split(), 'supertypes': [w for w in words if w in SUPER],
        'text': c.get('oracleText') or '', 'layout': 'normal', 'keywords': c.get('keywords') or [],
        'legalities': {'modern': 'Legal', 'legacy': 'Legal', 'vintage': 'Legal'}, 'identifiers': {'scryfallOracleId': c.get('oracleId')},
    }
    if c.get('power') is not None:
        card['power'], card['toughness'] = str(c['power']), str(c['toughness'])
    out[c['name']] = [card]
os.makedirs(os.path.join(out_dir, 'mtgjson', 'sets'), exist_ok=True)
json.dump({'meta': {'version': 'local'}, 'data': out}, open(os.path.join(out_dir, 'mtgjson', 'AtomicCards.json'), 'w'))
print(f'{len(out)} cards; skipped: {skipped}')
