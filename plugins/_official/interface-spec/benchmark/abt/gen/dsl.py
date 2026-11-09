"""Domain model DSL for the synthetic ABT (account-based ticketing) platform.

Everything the experiment scores against is computed from this model, never from the generated Java.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from typing import Optional

SCALARS = {'String', 'Long', 'Integer', 'BigDecimal', 'Boolean', 'LocalDate', 'LocalDateTime', 'OffsetDateTime', 'Double'}


@dataclass
class F:
    name: str
    type: str
    req: bool = False
    max: Optional[int] = None
    minv: Optional[int] = None
    pat: Optional[str] = None
    json: Optional[str] = None
    ignore: bool = False
    ko: Optional[str] = None
    default: Optional[str] = None

    @property
    def jname(self) -> str:
        return self.json or self.name


def f(spec: str) -> F:
    """'customerName String ! max=50 ko=고객명 json=customer_name'"""
    toks = spec.split()
    out = F(toks[0], toks[1])
    for t in toks[2:]:
        if t == '!':
            out.req = True
        elif t == 'ignore':
            out.ignore = True
        elif t.startswith('max='):
            out.max = int(t[4:])
        elif t.startswith('min='):
            out.minv = int(t[4:])
        elif t.startswith('pat='):
            out.pat = t[4:]
        elif t.startswith('json='):
            out.json = t[5:]
        elif t.startswith('ko='):
            out.ko = t[3:].replace('_', ' ')
        elif t.startswith('def='):
            out.default = t[4:]
        else:
            raise ValueError(f'unknown flag {t} in {spec}')
    return out


def fs(text: str) -> list[F]:
    return [f(p.strip()) for p in text.split(';') if p.strip()]


@dataclass
class Dto:
    name: str
    fields: list[F]
    style: str = 'lombok_data'      # lombok_data | lombok_getset | pojo | record | vo | builder | value
    module: str = 'common'
    ext: Optional[str] = None       # base class name
    doc: str = ''
    inner_of: Optional[str] = None  # emitted as a static nested class of this DTO


@dataclass
class Enum:
    name: str
    values: list[str]
    module: str = 'common'
    json_value: bool = False


@dataclass
class Param:
    kind: str       # path | query | header
    name: str
    type: str
    req: bool = True
    default: Optional[str] = None
    var: Optional[str] = None  # java variable name when different from `name`


@dataclass
class Ep:
    ctrl: str
    http: str
    path: str                      # path relative to the controller base
    method: str                    # java method name
    ko: Optional[str]              # Javadoc business name (None = no Javadoc)
    body: Optional[str] = None     # request DTO simple name
    cond: Optional[str] = None     # @ModelAttribute query object
    params: list[Param] = field(default_factory=list)
    resp: Optional[str] = None     # response DTO simple name / 'Map:k1,k2' / None
    wrap: str = 'api'              # api | page | list | entity | raw | rawlist | void204 | map | apivoid
    status: Optional[int] = None
    auth: str = 'authenticated'    # public | authenticated | role:X | scope:X | xml:ROLE
    alias: list[str] = field(default_factory=list)  # extra relative paths on the same handler
    deprecated: bool = False
    regex_path: bool = False       # use {id:[0-9]+} style in the source path
    multipart: bool = False
    produces: Optional[str] = None
    classic: bool = False          # @RequestMapping(method=...) instead of @GetMapping etc.
    pre_authorize: Optional[str] = None
    inherited: bool = False        # handler lives in an abstract base controller


@dataclass
class Ctrl:
    name: str
    module: str
    base: str                 # resolved base path (what the spec should show)
    base_expr: str            # java expression used in the annotation
    style: str                # rest | egov | partner
    doc: str = ''
    parent: Optional[str] = None   # abstract base controller
    service: str = ''
    aggregate: str = ''


@dataclass
class Model:
    dtos: dict[str, Dto] = field(default_factory=dict)
    enums: dict[str, Enum] = field(default_factory=dict)
    ctrls: dict[str, Ctrl] = field(default_factory=dict)
    eps: list[Ep] = field(default_factory=list)
    security: dict = field(default_factory=dict)   # public: list of (method|*, pattern)
    flags: dict = field(default_factory=dict)      # generator variants for decoy mutations
    defaults: dict = field(default_factory=dict)   # e.g. PageQuery.size

    def clone(self) -> 'Model':
        return copy.deepcopy(self)


# ---------------------------------------------------------------- truth
def full_path(model: Model, ep: Ep, rel: Optional[str] = None) -> str:
    c = model.ctrls[ep.ctrl]
    rel = ep.path if rel is None else rel
    p = (c.base.rstrip('/') + '/' + rel.lstrip('/')) if rel else c.base
    return re.sub(r'\{([A-Za-z0-9_]+):[^}]*\}', r'{\1}', p)


def cat(model: Model, t: str) -> str:
    if t.startswith('List<'):
        return 'array'
    if t.startswith('Map<'):
        return 'object'
    if t in ('Long', 'Integer'):
        return 'integer'
    if t in ('BigDecimal', 'Double'):
        return 'number'
    if t == 'Boolean':
        return 'boolean'
    if t in model.dtos:
        return 'object'
    return 'string'  # String, dates, enums


def _all_fields(model: Model, dto: Dto) -> list[F]:
    base = _all_fields(model, model.dtos[dto.ext]) if dto.ext else []
    return base + [x for x in dto.fields if not x.ignore]


def flatten(model: Model, dto_name: str, prefix: str = '', seen: tuple = ()) -> list[dict]:
    """JSON-visible fields as {path, cat, req, max}. Arrays are written `a[].b` (normalised away when scoring)."""
    if dto_name in seen:
        return []
    dto = model.dtos[dto_name]
    out = []
    for x in _all_fields(model, dto):
        p = f'{prefix}{x.jname}'
        c = cat(model, x.type)
        out.append({'path': p, 'cat': c, 'req': x.req, 'max': x.max, 'type': x.type})
        inner = x.type[5:-1] if x.type.startswith('List<') else x.type
        if inner in model.dtos:
            out.extend(flatten(model, inner, p + ('[].' if x.type.startswith('List<') else '.'), seen + (dto_name,)))
    return out


def request_fields(model: Model, ep: Ep) -> list[dict]:
    out = []
    for p in ep.params:
        if p.kind == 'path':
            out.append({'path': p.name, 'cat': cat(model, p.type), 'req': True, 'max': None, 'type': p.type, 'in': 'path'})
        else:
            out.append({'path': p.name, 'cat': cat(model, p.type), 'req': p.req and p.default is None, 'max': None, 'type': p.type, 'in': p.kind})
    if ep.cond:
        for x in flatten(model, ep.cond):
            out.append({**x, 'in': 'query'})
    if ep.body:
        for x in flatten(model, ep.body):
            out.append({**x, 'in': 'body'})
    if ep.multipart:
        out.append({'path': 'file', 'cat': 'string', 'req': True, 'max': None, 'in': 'body'})
    return out


def response_fields(model: Model, ep: Ep) -> list[dict]:
    if ep.wrap in ('void204', 'apivoid') or not ep.resp:
        return []
    if ep.wrap == 'map':
        keys = ep.resp.split(':', 1)[1].split(',')
        return [{'path': k.split('=')[0], 'cat': k.split('=')[1] if '=' in k else 'string', 'req': False, 'max': None} for k in keys]
    return flatten(model, ep.resp)


def auth_truth(model: Model, ep: Ep) -> dict:
    a = ep.auth
    if a == 'public':
        return {'required': False, 'detail': 'permitAll'}
    if a.startswith('xml:'):
        return {'required': True, 'detail': a}
    return {'required': True, 'detail': a}


def endpoints_truth(model: Model) -> list[dict]:
    out = []
    for ep in model.eps:
        for rel in [ep.path] + ep.alias:
            route = f'{ep.http} {full_path(model, ep, rel)}'
            out.append({
                'route': route,
                'ctrl': ep.ctrl, 'module': model.ctrls[ep.ctrl].module, 'handler': ep.method,
                'name_ko': ep.ko,
                'auth': auth_truth(model, ep),
                'request': request_fields(model, ep),
                'response': response_fields(model, ep),
            })
    return out
