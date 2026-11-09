import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import domain, mutate
from dsl import endpoints_truth
out = sys.argv[1]
m1 = domain.build_v1()
m2, entries = mutate.attributed_truth(m1)
json.dump(entries, open(os.path.join(out, 'truth_changes.json'), 'w'), ensure_ascii=False, indent=1)
json.dump(endpoints_truth(m1), open(os.path.join(out, 'truth_v1.json'), 'w'), ensure_ascii=False, indent=1)
json.dump(endpoints_truth(m2), open(os.path.join(out, 'truth_v2.json'), 'w'), ensure_ascii=False, indent=1)
print(len(entries), 'entries;', sum(1 for e in entries if e.get('secondary')), 'secondary;', sum(1 for e in entries if not e['vocab']), 'out-of-vocab')
