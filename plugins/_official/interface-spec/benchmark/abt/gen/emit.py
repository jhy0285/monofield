"""Java source emitters for the synthetic ABT platform. Produces a multi-module Maven project that compiles."""
from __future__ import annotations

import re
from pathlib import Path

from dsl import Ctrl, Dto, Ep, F, Model, SCALARS, _all_fields, full_path

ROOT_PKG = 'kr.example.abt'
SPRING_BOOT = '3.3.5'
CLOUD = '2023.0.3'
ENUM_MODULES: set = set()


def cap(s: str) -> str:
    return s[0].upper() + s[1:]


def pkgpath(module: str, layer: str) -> str:
    return f'{ROOT_PKG}.{module}.{layer}'


def srcdir(module: str, layer: str, test: bool = False) -> str:
    return f'abt-{module}/src/{"test" if test else "main"}/java/' + pkgpath(module, layer).replace('.', '/')


def imports(module: str, extra: list[str] | None = None) -> str:
    base = [
        'java.math.BigDecimal', 'java.io.Serializable', 'java.time.*', 'java.util.*',
        'jakarta.validation.Valid', 'jakarta.validation.constraints.*',
        'com.fasterxml.jackson.annotation.*', 'lombok.*',
        f'{ROOT_PKG}.common.dto.*', f'{ROOT_PKG}.common.type.*',
    ]
    if module != 'common':
        base += [f'{ROOT_PKG}.{module}.dto.*']
        if module in ENUM_MODULES:
            base += [f'{ROOT_PKG}.{module}.type.*']
    return '\n'.join(f'import {i};' for i in base + (extra or [])) + '\n'


# ------------------------------------------------------------------ DTOs
def field_anns(m: Model, x: F, record: bool = False) -> list[str]:
    out = []
    inner = x.type[5:-1] if x.type.startswith('List<') else x.type
    nested = inner in m.dtos
    if x.ignore:
        out.append('@JsonIgnore')
    if x.req:
        if x.type == 'String':
            out.append('@NotBlank')
        elif x.type.startswith('List<') or x.type.startswith('Map<'):
            out.append('@NotEmpty')
        else:
            out.append('@NotNull')
    if nested:
        out.append('@Valid')
    if x.max is not None and (x.type == 'String' or x.type.startswith('List<')):
        out.append(f'@Size(max = {x.max})')
    if x.minv is not None and x.type in ('Integer', 'Long'):
        out.append(f'@Min({x.minv})')
    if x.pat:
        out.append(f'@Pattern(regexp = "{x.pat}")')
    if x.json:
        out.append(f'@JsonProperty("{x.json}")')
    return out


def getter(dto: Dto, name: str) -> str:
    return f'{name}()' if dto.style == 'record' else f'get{cap(name)}()'


def emit_dto(m: Model, d: Dto) -> tuple[str, str]:
    mod = d.module
    fields = list(d.fields)
    if m.flags.get('reorder_tariff') and d.name == 'TariffResponse':
        fields = list(reversed(fields))
    head = f'package {pkgpath(mod, "dto")};\n\n{imports(mod)}\n'
    doc = f'/**\n * {d.doc or d.name}\n */\n'
    ext = f' extends {d.ext}' if d.ext else ''
    body = ''
    if d.style == 'record':
        comps = []
        for x in fields:
            anns = ' '.join(field_anns(m, x, True))
            comps.append(f'        {anns + " " if anns else ""}{x.type} {x.name}')
        decl = f'public record {d.name}(\n' + ',\n'.join(comps) + '\n) {}\n'
        return f'{srcdir(mod, "dto")}/{d.name}.java', head + doc + decl
    lombok = {
        'lombok_data': '@Data' + ('\n@EqualsAndHashCode(callSuper = true)' if d.ext else ''),
        'lombok_getset': '@Getter\n@Setter\n@NoArgsConstructor',
        'builder': '@Getter\n@Builder\n@NoArgsConstructor\n@AllArgsConstructor',
        'value': '@Value\n@Builder',
        'pojo': '',
        'vo': '',
    }[d.style]
    impl = ' implements Serializable' if d.style in ('vo', 'pojo') else ''
    lines = [doc + (lombok + '\n' if lombok else '') + f'public class {d.name}{ext}{impl} {{\n']
    if d.style in ('vo', 'pojo'):
        lines.append('    private static final long serialVersionUID = 1L;\n')
    for x in fields:
        if x.ko:
            lines.append(f'    /** {x.ko} */')
        for a in field_anns(m, x):
            lines.append(f'    {a}')
        init = ''
        if x.name in ('page', 'size') and d.name == 'PageQuery':
            init = f' = {m.defaults.get(x.name, x.default)}'
        elif x.default is not None:
            init = f' = {x.default}'
        mod_ = 'private final' if d.style == 'value' else 'private'
        lines.append(f'    {mod_} {x.type} {x.name}{init};\n')
    if d.style in ('pojo', 'vo'):
        for x in fields:
            lines.append(f'    public {x.type} get{cap(x.name)}() {{\n        return {x.name};\n    }}\n')
            lines.append(f'    public void set{cap(x.name)}({x.type} {x.name}) {{\n        this.{x.name} = {x.name};\n    }}\n')
        if d.style == 'vo':
            lines.append('    @Override\n    public String toString() {\n        return getClass().getSimpleName() + "@" + Integer.toHexString(hashCode());\n    }\n')
    lines.append('}\n')
    return f'{srcdir(mod, "dto")}/{d.name}.java', head + '\n'.join(lines)


def emit_enum(e) -> tuple[str, str]:
    mod = e.module
    vals = ',\n'.join(f'    {v}' + (f'("{v.lower()}")' if e.json_value else '') for v in e.values)
    if e.json_value:
        body = (f'package {pkgpath(mod, "type")};\n\nimport com.fasterxml.jackson.annotation.JsonValue;\n\npublic enum {e.name} {{\n{vals};\n\n'
                f'    private final String code;\n\n    {e.name}(String code) {{\n        this.code = code;\n    }}\n\n    @JsonValue\n    public String getCode() {{\n        return code;\n    }}\n}}\n')
    else:
        body = f'package {pkgpath(mod, "type")};\n\npublic enum {e.name} {{\n{vals}\n}}\n'
    return f'{srcdir(mod, "type")}/{e.name}.java', body


# ------------------------------------------------------------------ controllers
def jparam(p) -> str:
    var = p.var or p.name
    if p.kind == 'path':
        ann = f'@PathVariable("{p.name}")' if p.var or '-' in p.name else '@PathVariable'
    elif p.kind == 'header':
        ann = f'@RequestHeader(name = "{p.name}"' + (', required = false' if not p.req else '') + ')'
    else:
        opts = []
        if p.var or p.name != var:
            opts.append(f'name = "{p.name}"')
        if not p.req:
            opts.append('required = false')
        if p.default is not None:
            opts = [o for o in opts if not o.startswith('required')] + [f'defaultValue = "{p.default}"']
            if not any(o.startswith('name') for o in opts):
                opts.insert(0, f'name = "{p.name}"')
        ann = '@RequestParam' + (f'({", ".join(opts)})' if opts else '')
    return f'{ann} {p.type} {var}'


def ordered_params(ep: Ep):
    order = {'path': 0, 'header': 1, 'query': 2}
    return sorted(ep.params, key=lambda p: order[p.kind])


def handler_args(ep: Ep) -> list[tuple[str, str]]:
    """(java declaration, variable name) in call order."""
    out = [(jparam(p), p.var or p.name) for p in ordered_params(ep)]
    if ep.cond:
        out.append((f'@Valid @ModelAttribute {ep.cond} cond', 'cond'))
    if ep.body:
        out.append((f'@Valid @RequestBody {ep.body} request', 'request'))
    if ep.multipart:
        out.append(('@RequestParam("file") MultipartFile file', 'file'))
    return out


def service_ret(ep: Ep) -> str:
    if ep.wrap in ('void204', 'apivoid') or not ep.resp:
        return 'void'
    if ep.wrap == 'map':
        return 'Map<String, Object>'
    if ep.wrap == 'page':
        return f'PageResponse<{ep.resp}>'
    if ep.wrap in ('list', 'rawlist'):
        return f'List<{ep.resp}>'
    return ep.resp


def ctrl_ret(ep: Ep) -> str:
    r = ep.resp
    return {
        'api': f'ApiResponse<{r}>', 'page': f'ApiResponse<PageResponse<{r}>>', 'list': f'ApiResponse<List<{r}>>',
        'entity': f'ResponseEntity<ApiResponse<{r}>>', 'raw': f'{r}', 'rawlist': f'List<{r}>',
        'void204': 'ResponseEntity<Void>', 'apivoid': 'ApiResponse<Void>', 'map': 'Map<String, Object>',
    }[ep.wrap]


def mapping_ann(ep: Ep, rel: str, aliases: list[str]) -> str:
    paths = [rel] + aliases
    verb = ep.http.capitalize()
    if ep.classic:
        pv = f'"{rel}"' if not aliases else '{' + ', '.join(f'"{p}"' for p in paths) + '}'
        return f'@RequestMapping(value = {pv}, method = RequestMethod.{ep.http})'
    if len(paths) == 1:
        arg = f'("{rel}")' if rel else ''
    else:
        arg = '({' + ', '.join(f'"{p}"' for p in paths) + '})'
    return f'@{verb}Mapping{arg}'


def emit_handler(m: Model, ep: Ep, indent: str = '    ') -> str:
    args = handler_args(ep)
    decl = ', '.join(a for a, _ in args)
    call = ', '.join(v for _, v in args)
    rel = ep.path
    lines = []
    if ep.ko:
        lines.append(f'/** {ep.ko} */')
    if ep.deprecated:
        lines.append('@Deprecated')
    if ep.pre_authorize:
        lines.append(f'@PreAuthorize("{ep.pre_authorize}")')
    c = m.ctrls[ep.ctrl]
    lines.append(mapping_ann(ep, rel, ep.alias))
    if c.style == 'egov':
        lines.append('@ResponseBody')
    if ep.status == 201 and ep.wrap not in ('entity',):
        lines.append('@ResponseStatus(HttpStatus.CREATED)')
    ret = ctrl_ret(ep)
    sig = f'public {ret} {ep.method}({decl}) {{'
    svc = f'service.{ep.method}({call})'
    if ep.wrap in ('api', 'page', 'list'):
        body = f'return ApiResponse.ok({svc});'
    elif ep.wrap == 'entity':
        body = (f'return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok({svc}));' if ep.status == 201 else f'return ResponseEntity.ok(ApiResponse.ok({svc}));')
    elif ep.wrap in ('raw', 'rawlist', 'map'):
        body = f'return {svc};'
    elif ep.wrap == 'void204':
        body = f'{svc};\n        return ResponseEntity.noContent().build();'
    else:
        body = f'{svc};\n        return ApiResponse.ok(null);'
    text = '\n'.join(lines + [sig, f'        {body}', '}'])
    return '\n'.join(indent + l if l else l for l in text.split('\n')) + '\n'


def emit_controller(m: Model, c: Ctrl) -> tuple[str, str]:
    mod = c.module
    eps = [e for e in m.eps if e.ctrl == c.name and not e.inherited]
    anns = {'rest': '@RestController', 'egov': '@Controller', 'partner': '@RestController'}[c.style]
    extra = ['org.springframework.web.bind.annotation.*', 'org.springframework.http.*', 'org.springframework.web.multipart.MultipartFile',
             'org.springframework.security.access.prepost.PreAuthorize', f'{ROOT_PKG}.common.*', f'{ROOT_PKG}.{mod}.service.{c.service}']
    if c.style == 'egov':
        extra += ['jakarta.annotation.Resource', 'org.springframework.stereotype.Controller']
    head = f'package {pkgpath(mod, "controller")};\n\n{imports(mod, extra)}\n'
    parent = f' extends {c.parent}' if c.parent else ''
    cls = [f'/**\n * {c.doc}\n */', anns, f'@RequestMapping({c.base_expr})']
    if c.style in ('rest', 'partner'):
        cls.append('@RequiredArgsConstructor')
    body = [f'public class {c.name}{parent} {{\n']
    if c.style == 'egov':
        body.append(f'    @Resource(name = "{c.service[0].lower() + c.service[1:]}")\n    private {c.service} service;\n')
    else:
        body.append(f'    private final {c.service} service;\n')
    if c.parent:
        body.append(f'    @Override\n    protected LookupResponse doLookup(String id) {{\n        return service.lookup(id);\n    }}\n')
    for e in eps:
        body.append(emit_handler(m, e))
    if c.name == 'AccountController':
        body.append('    // 2023-04: 구 앱 호환용 조회 API. 신규 앱 전환 후 제거 (이관 완료)\n    // @Deprecated\n    // @GetMapping("/legacy/{id}")\n'
                    '    // public ApiResponse<AccountResponse> getLegacy(@PathVariable Long id) {\n    //     return ApiResponse.ok(service.getAccount(id));\n    // }\n')
    if c.name == 'FareController':
        body.append('    /*\n     * 요금 재계산 일괄 API는 정산 배치로 이관되어 삭제했다.\n     * @PostMapping("/recalculate-all")\n     * public ApiResponse<Void> recalculateAll() { ... }\n     */\n')
    return f'{srcdir(mod, "controller")}/{c.name}.java', head + '\n'.join(cls) + '\n' + '\n'.join(body) + '}\n'


def emit_abstract_lookup() -> tuple[str, str]:
    return (f'{srcdir("admin", "controller")}/AbstractLookupController.java',
            f'package {pkgpath("admin", "controller")};\n\nimport org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.PathVariable;\n'
            f'import {ROOT_PKG}.admin.dto.LookupResponse;\nimport {ROOT_PKG}.common.ApiResponse;\n\n'
            '/** 단건 조회 공통 골격. 하위 컨트롤러가 조회 방식을 구현한다. */\npublic abstract class AbstractLookupController {\n\n'
            '    protected abstract LookupResponse doLookup(String id);\n\n    /** 코드 단건 조회 */\n    @GetMapping("/lookup/{id}")\n'
            '    public ApiResponse<LookupResponse> lookup(@PathVariable("id") String id) {\n        return ApiResponse.ok(doLookup(id));\n    }\n}\n')


# ------------------------------------------------------------------ services, entities, repositories
def aggregates(m: Model, module: str) -> dict[str, list[F]]:
    out: dict[str, list[F]] = {}
    for c in m.ctrls.values():
        if c.module != module:
            continue
        if c.aggregate in out:
            continue
        flds: list[F] = []
        for e in m.eps:
            if e.ctrl == c.name and e.resp and e.resp in m.dtos:
                flds = [x for x in _all_fields(m, m.dtos[e.resp]) if x.type in SCALARS][:7]
                break
        out[c.aggregate] = flds
    return out


def emit_entity(m: Model, module: str, agg: str, flds: list[F]) -> tuple[str, str]:
    cols = []
    seen = {'id', 'externalKey', 'createdAt'}
    for x in flds:
        if x.name in seen:
            continue
        seen.add(x.name)
        length = ''
        if x.type == 'String':
            n = 120 if (m.flags.get('entity_len') and agg == 'Account') else 100
            length = f'(length = {n})'
        cols.append(f'    @Column{length}\n    private {x.type} {x.name};\n')
    body = (f'package {pkgpath(module, "domain")};\n\nimport jakarta.persistence.*;\nimport java.math.BigDecimal;\nimport java.time.*;\nimport lombok.*;\n\n'
            f'@Entity\n@Table(name = "ABT_{module.upper()}_{agg.upper()}")\n@Getter\n@Setter\n@NoArgsConstructor\npublic class {agg}Entity {{\n\n'
            '    @Id\n    @GeneratedValue(strategy = GenerationType.IDENTITY)\n    private Long id;\n\n    @Column(length = 64)\n    private String externalKey;\n\n'
            '    @Column\n    private LocalDateTime createdAt = LocalDateTime.now();\n\n' + '\n'.join(cols) + '}\n')
    return f'{srcdir(module, "domain")}/{agg}Entity.java', body


def emit_repository(module: str, agg: str) -> tuple[str, str]:
    body = (f'package {pkgpath(module, "repository")};\n\nimport java.util.Optional;\nimport org.springframework.data.jpa.repository.JpaRepository;\n'
            f'import {pkgpath(module, "domain")}.{agg}Entity;\n\npublic interface {agg}Repository extends JpaRepository<{agg}Entity, Long> {{\n\n'
            f'    Optional<{agg}Entity> findByExternalKey(String externalKey);\n}}\n')
    return f'{srcdir(module, "repository")}/{agg}Repository.java', body


def service_sig(ep: Ep) -> str:
    decl = ', '.join(a.split(' ', 1)[1] if a.startswith('@') and not a.startswith('@Valid') else a for a, _ in handler_args(ep))
    # drop annotations, keep "Type name"
    parts = []
    for a, v in handler_args(ep):
        t = re.sub(r'@\w+(\([^)]*\))?\s*', '', a).strip()
        parts.append(t)
    return f'{service_ret(ep)} {ep.method}({", ".join(parts)})'


def emit_service_iface(m: Model, module: str, svc: str) -> tuple[str, str]:
    eps = [e for e in m.eps if m.ctrls[e.ctrl].module == module and m.ctrls[e.ctrl].service == svc]
    extra = ['org.springframework.web.multipart.MultipartFile', f'{ROOT_PKG}.common.*']
    body = f'package {pkgpath(module, "service")};\n\n{imports(module, extra)}\npublic interface {svc} {{\n\n' + ''.join(f'    {service_sig(e)};\n\n' for e in eps)
    if any(e.inherited for e in eps):
        pass
    return f'{srcdir(module, "service")}/{svc}.java', body + '}\n'


def log_line(m: Model, ep: Ep) -> str:
    if ep.body:
        d = m.dtos[ep.body]
        fl = [x for x in d.fields if not x.ignore][:2]
        if fl:
            fmt = ' '.join(f'{x.name}={{}}' for x in fl)
            args = ', '.join(f'request.{getter(d, x.name)}' for x in fl)
            return f'log.info("{ep.method} {fmt}", {args});'
    if ep.cond:
        cd = m.dtos[ep.cond]
        if cd.ext == 'PageQuery':
            return f'log.info("{ep.method} page={{}} size={{}}", cond.getPage(), cond.getSize());'
        first = [x for x in cd.fields if not x.ignore][0]
        return f'log.info("{ep.method} {first.name}={{}}", cond.{getter(cd, first.name)});'
    ps = ordered_params(ep)
    if ps:
        v = ps[0].var or ps[0].name
        return f'log.info("{ep.method} {v}={{}}", {v});'
    return f'log.info("{ep.method}");'


def emit_service_impl(m: Model, module: str, svc: str) -> tuple[str, str]:
    eps = [e for e in m.eps if m.ctrls[e.ctrl].module == module and m.ctrls[e.ctrl].service == svc]
    aggs = aggregates(m, module)
    ctrls = {m.ctrls[e.ctrl].aggregate for e in eps}
    extra = ['org.springframework.web.multipart.MultipartFile', 'org.springframework.beans.BeanUtils', 'org.springframework.data.domain.*',
             'org.springframework.stereotype.Service', 'org.springframework.transaction.annotation.Transactional', 'com.fasterxml.jackson.databind.ObjectMapper',
             'lombok.extern.slf4j.Slf4j', f'{ROOT_PKG}.common.*', f'{pkgpath(module, "service")}.{svc}', f'{pkgpath(module, "domain")}.*', f'{pkgpath(module, "repository")}.*']
    lines = [f'package {pkgpath(module, "service.impl")};\n\n{imports(module, extra)}',
             f'@Slf4j\n@Service\n@RequiredArgsConstructor\npublic class {svc}Impl implements {svc} {{\n']
    for a in sorted(ctrls):
        lines.append(f'    private final {a}Repository {a[0].lower() + a[1:]}Repository;')
    lines.append('    private final ObjectMapper mapper;\n')
    for e in eps:
        agg = m.ctrls[e.ctrl].aggregate
        repo = f'{agg[0].lower() + agg[1:]}Repository'
        ent = f'{agg}Entity'
        tx = '@Transactional(readOnly = true)' if e.http == 'GET' and m.flags.get('entity_len') and svc == 'AccountService' else ('@Transactional' if e.http != 'GET' else '')
        lines.append('    @Override')
        if tx:
            lines.append(f'    {tx}')
        lines.append(f'    public {service_sig(e)} {{')
        lines.append(f'        {log_line(m, e)}')
        if m.flags.get('comment_edit') and svc == 'AccountService' and e.method == 'openAccount':
            lines.append('        // 개설 직후 한도 초기화는 배치에서 처리한다 (이전: 서비스에서 직접 처리)')
        rt = service_ret(e)
        if e.multipart:
            lines.append('        log.info("upload {} bytes", file.getSize());')
        if e.wrap == 'map':
            lines.append('        Map<String, Object> result = new HashMap<>();')
            for kv in e.resp.split(':', 1)[1].split(','):
                k, _, c = kv.partition('=')
                val = {'number': 'BigDecimal.ZERO', 'integer': '0', 'string': '"OK"'}.get(c, '"OK"')
                lines.append(f'        result.put("{k}", {val});')
            lines.append('        return result;')
        elif rt == 'void':
            pid = ordered_params(e)
            if e.http == 'DELETE' and pid and pid[-1].type == 'Long':
                lines.append(f'        {repo}.deleteById({pid[-1].var or pid[-1].name});')
            else:
                lines.append(f'        {repo}.findAll();')
        elif e.wrap == 'page':
            lines.append(f'        Page<{ent}> page = {repo}.findAll(PageRequest.of(cond.getPage(), cond.getSize()));')
            lines.append(f'        List<{e.resp}> items = new ArrayList<>();')
            lines.append(f'        page.forEach(row -> items.add(mapper.convertValue(row, {e.resp}.class)));')
            lines.append('        return PageResponse.of(items, page.getNumber(), page.getSize(), page.getTotalElements());')
        elif e.wrap in ('list', 'rawlist'):
            lines.append(f'        List<{e.resp}> items = new ArrayList<>();')
            lines.append(f'        {repo}.findAll().forEach(row -> items.add(mapper.convertValue(row, {e.resp}.class)));')
            lines.append('        return items;')
        else:
            if e.body:
                lines.append(f'        {ent} entity = new {ent}();')
                lines.append('        BeanUtils.copyProperties(request, entity);')
                lines.append(f'        entity = {repo}.save(entity);')
            else:
                ps = ordered_params(e)
                ids = [p for p in ps if p.kind == 'path']
                if ids and ids[-1].type == 'Long':
                    lines.append(f'        {ent} entity = {repo}.findById({ids[-1].var or ids[-1].name}).orElseThrow(() -> new IllegalArgumentException("not found"));')
                elif ids:
                    lines.append(f'        {ent} entity = {repo}.findByExternalKey({ids[-1].var or ids[-1].name}).orElseThrow(() -> new IllegalArgumentException("not found"));')
                else:
                    lines.append(f'        {ent} entity = {repo}.findAll().stream().findFirst().orElseGet({ent}::new);')
            lines.append(f'        return mapper.convertValue(entity, {e.resp}.class);')
        lines.append('    }\n')
    lines.append('}\n')
    return f'{srcdir(module, "service.impl")}/{svc}Impl.java', '\n'.join(lines)


# ------------------------------------------------------------------ common, config, clients, logic
def common_files(m: Model) -> dict[str, str]:
    c = 'abt-common/src/main/java/kr/example/abt/common'
    f = {}
    f[f'{c}/ApiPaths.java'] = (f'package {ROOT_PKG}.common;\n\npublic final class ApiPaths {{\n    public static final String V1 = "/api/v1";\n    public static final String ACCOUNTS = V1 + "/accounts";\n'
                               '    public static final String PAYMENTS = V1 + "/payments";\n\n    private ApiPaths() {\n    }\n}\n')
    f[f'{c}/ApiResponse.java'] = (f'package {ROOT_PKG}.common;\n\nimport lombok.AllArgsConstructor;\nimport lombok.Getter;\nimport lombok.NoArgsConstructor;\nimport lombok.Setter;\n\n'
                                  '@Getter\n@Setter\n@NoArgsConstructor\n@AllArgsConstructor\npublic class ApiResponse<T> {\n    private String code;\n    private String message;\n    private T data;\n    private String traceId;\n\n'
                                  '    public static <T> ApiResponse<T> ok(T data) {\n        return new ApiResponse<>("0000", "OK", data, null);\n    }\n}\n')
    f[f'{c}/PageResponse.java'] = (f'package {ROOT_PKG}.common;\n\nimport java.util.List;\nimport lombok.AllArgsConstructor;\nimport lombok.Getter;\nimport lombok.NoArgsConstructor;\nimport lombok.Setter;\n\n'
                                   '@Getter\n@Setter\n@NoArgsConstructor\n@AllArgsConstructor\npublic class PageResponse<T> {\n    private List<T> content;\n    private int page;\n    private int size;\n    private long totalElements;\n\n'
                                   '    public static <T> PageResponse<T> of(List<T> content, int page, int size, long total) {\n        return new PageResponse<>(content, page, size, total);\n    }\n}\n')
    f[f'{c}/GlobalExceptionHandler.java'] = (f'package {ROOT_PKG}.common;\n\nimport org.springframework.http.HttpStatus;\nimport org.springframework.web.bind.annotation.ExceptionHandler;\nimport org.springframework.web.bind.annotation.ResponseStatus;\n'
                                             'import org.springframework.web.bind.annotation.RestControllerAdvice;\n\n@RestControllerAdvice\npublic class GlobalExceptionHandler {\n\n'
                                             '    @ExceptionHandler(IllegalArgumentException.class)\n    @ResponseStatus(HttpStatus.BAD_REQUEST)\n    public ApiResponse<Void> handleIllegalArgument(IllegalArgumentException e) {\n'
                                             '        return new ApiResponse<>("4000", e.getMessage(), null, null);\n    }\n}\n')
    return f


def feign_files(m: Model) -> dict[str, str]:
    b = 'abt-billing/src/main/java/kr/example/abt/billing/client'
    extra = ' , @RequestParam(name = "channel", required = false) String channel' if m.flags.get('pg_client_param') else ''
    pg = (f'package {ROOT_PKG}.billing.client;\n\nimport org.springframework.cloud.openfeign.FeignClient;\nimport org.springframework.web.bind.annotation.*;\n\n'
          '/** 외부 PG사 호출 클라이언트(이 시스템이 제공하는 API가 아님) */\n@FeignClient(name = "pg", url = "${abt.pg.url}")\npublic interface PgClient {\n\n'
          '    @PostMapping("/v1/payments/approve")\n    PgApproveResult approve(@RequestBody PgApproveCommand command);\n\n'
          f'    @PostMapping("/v1/payments/{{pgTransactionId}}/cancel")\n    PgApproveResult cancel(@PathVariable("pgTransactionId") String pgTransactionId, @RequestBody PgCancelCommand command{extra.replace(" , ", ", ")});\n\n'
          '    @GetMapping("/v1/settlements/{date}")\n    PgSettlementReport settlement(@PathVariable("date") String date);\n}\n')
    iss = (f'package {ROOT_PKG}.billing.client;\n\nimport org.springframework.cloud.openfeign.FeignClient;\nimport org.springframework.web.bind.annotation.*;\n\n'
           '/** 카드 발급사 상태 조회 클라이언트 */\n@FeignClient(name = "issuer", url = "${abt.issuer.url}")\npublic interface IssuerClient {\n\n'
           '    @GetMapping("/cards/{token}/status")\n    CardStatusResult status(@PathVariable("token") String token);\n\n    @PutMapping("/cards/{token}/block")\n    void block(@PathVariable("token") String token);\n}\n')
    dtos = {
        'PgApproveCommand': 'String merchantUid; java.math.BigDecimal amount; String cardToken;',
        'PgCancelCommand': 'String reason; java.math.BigDecimal amount;',
        'PgApproveResult': 'String pgTransactionId; String status; String failureCode;',
        'PgSettlementReport': 'java.math.BigDecimal total; int count;',
        'CardStatusResult': 'String status; String issuerMessage;',
    }
    out = {f'{b}/PgClient.java': pg, f'{b}/IssuerClient.java': iss}
    for n, body in dtos.items():
        fields = ''.join(f'    private {t.strip()};\n' for t in body.split(';') if t.strip())
        out[f'{b}/{n}.java'] = f'package {ROOT_PKG}.billing.client;\n\nimport lombok.Data;\n\n@Data\npublic class {n} {{\n{fields}}}\n'
    return out


def logic_files(m: Model) -> dict[str, str]:
    fl = m.flags
    f = {}
    rounding = 'RoundingMode.HALF_UP' if fl.get('fare_rounding') else 'RoundingMode.DOWN'
    unit = '10' if fl.get('fare_rounding') else '10'
    f['abt-fare/src/main/java/kr/example/abt/fare/logic/FareCalculator.java'] = f'''package {ROOT_PKG}.fare.logic;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/** 거리 비례 요금 계산. 기본요율 + 구간별 단위요율. */
public class FareCalculator {{

    public static class Tier {{
        public final int fromMeters;
        public final int toMeters;
        public final int perUnitMeters;
        public final BigDecimal unitFare;

        public Tier(int fromMeters, int toMeters, int perUnitMeters, BigDecimal unitFare) {{
            this.fromMeters = fromMeters;
            this.toMeters = toMeters;
            this.perUnitMeters = perUnitMeters;
            this.unitFare = unitFare;
        }}
    }}

    public BigDecimal distanceFare(int distanceMeters, List<Tier> tiers) {{
        BigDecimal total = BigDecimal.ZERO;
        for (Tier tier : tiers) {{
            if (distanceMeters <= tier.fromMeters) {{
                break;
            }}
            int upper = tier.toMeters <= 0 ? distanceMeters : Math.min(distanceMeters, tier.toMeters);
            int span = upper - tier.fromMeters;
            if (span <= 0) {{
                continue;
            }}
            long units = (span + tier.perUnitMeters - 1) / tier.perUnitMeters;
            total = total.add(tier.unitFare.multiply(BigDecimal.valueOf(units)));
        }}
        return roundToTen(total);
    }}

    /** 10원 단위로 절사한다. */
    BigDecimal roundToTen(BigDecimal value) {{
        return value.divide(BigDecimal.valueOf({unit}), 0, {rounding}).multiply(BigDecimal.valueOf({unit}));
    }}
}}
'''
    f['abt-fare/src/main/java/kr/example/abt/fare/logic/TransferPolicy.java'] = f'''package {ROOT_PKG}.fare.logic;

import java.time.Duration;
import java.time.LocalDateTime;

/** 환승 인정 정책: 하차 후 일정 시간 안에 다시 승차하면 환승. */
public class TransferPolicy {{

    private static final int WINDOW_MINUTES = 30;
    private static final int MAX_TRANSFERS = 4;

    public boolean eligible(LocalDateTime prevAlighted, LocalDateTime nextBoarded, int transfersSoFar) {{
        if (prevAlighted == null || nextBoarded == null || nextBoarded.isBefore(prevAlighted)) {{
            return false;
        }}
        long minutes = Duration.between(prevAlighted, nextBoarded).toMinutes();
        return minutes <= WINDOW_MINUTES && transfersSoFar < MAX_TRANSFERS;
    }}

    public int windowMinutes() {{
        return WINDOW_MINUTES;
    }}
}}
'''
    alloc_a = '''    List<Allocation> allocate(BigDecimal net, List<Share> shares) {
        BigDecimal remaining = net;
        List<Allocation> out = new ArrayList<>();
        for (int i = 0; i < shares.size(); i++) {
            Share share = shares.get(i);
            BigDecimal amount = i == shares.size() - 1 ? remaining : net.multiply(share.ratio).setScale(0, RoundingMode.DOWN);
            remaining = remaining.subtract(amount);
            out.add(new Allocation(share.operatorId, amount));
        }
        return out;
    }'''
    alloc_b = '''    List<Allocation> allocate(BigDecimal net, List<Share> shares) {
        List<Allocation> out = new ArrayList<>();
        BigDecimal remaining = distribute(net, shares, out);
        if (remaining.signum() != 0 && !out.isEmpty()) {
            Allocation last = out.get(out.size() - 1);
            out.set(out.size() - 1, new Allocation(last.operatorId, last.amount.add(remaining)));
        }
        return out;
    }

    private BigDecimal distribute(BigDecimal net, List<Share> shares, List<Allocation> out) {
        BigDecimal used = BigDecimal.ZERO;
        for (Share share : shares) {
            BigDecimal amount = net.multiply(share.ratio).setScale(0, RoundingMode.DOWN);
            used = used.add(amount);
            out.add(new Allocation(share.operatorId, amount));
        }
        return net.subtract(used);
    }'''
    f['abt-settlement/src/main/java/kr/example/abt/settlement/logic/SettlementAllocator.java'] = f'''package {ROOT_PKG}.settlement.logic;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/** 운수사 간 정산 금액 배분. 단수는 마지막 운수사에 몰아 준다. */
public class SettlementAllocator {{

    public static class Share {{
        public final String operatorId;
        public final BigDecimal ratio;

        public Share(String operatorId, BigDecimal ratio) {{
            this.operatorId = operatorId;
            this.ratio = ratio;
        }}
    }}

    public static class Allocation {{
        public final String operatorId;
        public final BigDecimal amount;

        public Allocation(String operatorId, BigDecimal amount) {{
            this.operatorId = operatorId;
            this.amount = amount;
        }}
    }}

{alloc_b if fl.get('refactor_allocator') else alloc_a}
}}
'''
    f['abt-billing/src/main/java/kr/example/abt/billing/logic/PaymentStateMachine.java'] = f'''package {ROOT_PKG}.billing.logic;

import {ROOT_PKG}.billing.type.PaymentStatus;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/** 결제 상태 전이 규칙. */
public class PaymentStateMachine {{

    private final Map<PaymentStatus, Set<PaymentStatus>> transitions = new EnumMap<>(PaymentStatus.class);

    public PaymentStateMachine() {{
        transitions.put(PaymentStatus.PENDING, EnumSet.of(PaymentStatus.APPROVED, PaymentStatus.FAILED, PaymentStatus.CANCELLED));
        transitions.put(PaymentStatus.APPROVED, EnumSet.of(PaymentStatus.CANCELLED, PaymentStatus.REFUNDED));
        transitions.put(PaymentStatus.FAILED, EnumSet.noneOf(PaymentStatus.class));
        transitions.put(PaymentStatus.CANCELLED, EnumSet.noneOf(PaymentStatus.class));
        transitions.put(PaymentStatus.REFUNDED, EnumSet.noneOf(PaymentStatus.class));
    }}

    public boolean canMove(PaymentStatus from, PaymentStatus to) {{
        return transitions.getOrDefault(from, EnumSet.noneOf(PaymentStatus.class)).contains(to);
    }}
}}
'''
    f['abt-tap/src/main/java/kr/example/abt/tap/logic/TapDeduplicator.java'] = f'''package {ROOT_PKG}.tap.logic;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.Map;

/** 같은 수단의 짧은 시간 내 중복 태그를 걸러낸다. */
public class TapDeduplicator {{

    private static final Duration WINDOW = Duration.ofSeconds(3);
    private final Map<String, OffsetDateTime> lastSeen = new HashMap<>();

    public synchronized boolean isDuplicate(String mediaToken, OffsetDateTime taggedAt) {{
        OffsetDateTime previous = lastSeen.put(mediaToken, taggedAt);
        return previous != null && Duration.between(previous, taggedAt).abs().compareTo(WINDOW) < 0;
    }}
}}
'''
    f['abt-common/src/main/java/kr/example/abt/common/audit/AuditPublisher.java'] = f'''package {ROOT_PKG}.common.audit;

import {ROOT_PKG}.common.dto.AuditEnvelope;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/** 감사 이벤트를 로그로 남긴다. API로 노출되지 않는 내부 포장 객체를 쓴다. */
@Slf4j
@Component
public class AuditPublisher {{

    public void publish(AuditEnvelope envelope) {{
        log.info("audit actor={{}} action={{}}", envelope.getActor(), envelope.getAction());
    }}
}}
'''
    return f


def config_files(m: Model) -> dict[str, str]:
    f = {}
    app = 'abt-app/src/main/java/kr/example/abt'
    f[f'{app}/AbtApplication.java'] = (f'package {ROOT_PKG};\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n'
                                       'import org.springframework.cloud.openfeign.EnableFeignClients;\nimport org.springframework.boot.autoconfigure.domain.EntityScan;\nimport org.springframework.data.jpa.repository.config.EnableJpaRepositories;\n\n'
                                       '@SpringBootApplication\n@EnableFeignClients\n@EntityScan("kr.example.abt")\n@EnableJpaRepositories("kr.example.abt")\npublic class AbtApplication {\n\n'
                                       '    public static void main(String[] args) {\n        SpringApplication.run(AbtApplication.class, args);\n    }\n}\n')
    # public matchers derived from the model
    groups: dict[str, list[Ep]] = {}
    for e in m.eps:
        if e.auth == 'public':
            groups.setdefault(e.ctrl, []).append(e)
    lines = []
    for cname, eps in groups.items():
        total = [e for e in m.eps if e.ctrl == cname]
        c = m.ctrls[cname]
        if len(eps) == len(total) and len(total) >= 2:
            lines.append(f'                        .requestMatchers("{c.base}/**").permitAll()')
        elif len(eps) == len(total) and len(total) == 1:
            lines.append(f'                        .requestMatchers("{full_path(m, eps[0])}").permitAll()')
        else:
            bym: dict[str, list[str]] = {}
            for e in eps:
                for rel in [e.path] + e.alias:
                    bym.setdefault(e.http, []).append(re.sub(r'\{[^}]+\}', '*', full_path(m, e, rel)))
            for http, paths in bym.items():
                lines.append(f'                        .requestMatchers(HttpMethod.{http}, ' + ', '.join(f'"{p}"' for p in paths) + ').permitAll()')
    f[f'{app}/config/SecurityConfig.java'] = f'''package {ROOT_PKG}.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;

/**
 * REST API 보안 설정. 정산 화면(.do)은 전자정부 방식 XML 설정(context-security.xml)이 담당한다.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {{

    @Bean
    public SecurityFilterChain apiChain(HttpSecurity http) throws Exception {{
        http
                .securityMatcher("/api/**", "/partner/**", "/health")
                .csrf(AbstractHttpConfigurer::disable)
                .authorizeHttpRequests(auth -> auth
{chr(10).join(lines)}
                        .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
                        .requestMatchers("/partner/**").authenticated()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> {{
                }}));
        return http.build();
    }}
}}
'''
    xml = ''.join(f'        <intercept-url pattern="{pat}" access="hasRole(\'{role}\')"/>\n' for pat, role in sorted({(m.ctrls[e.ctrl].base + '/**', e.auth[4:]) for e in m.eps if e.auth.startswith('xml:')}))
    f['abt-app/src/main/resources/egovframework/spring/context-security.xml'] = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<beans:beans xmlns="http://www.springframework.org/schema/security"\n             xmlns:beans="http://www.springframework.org/schema/beans"\n'
        '             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n             xsi:schemaLocation="http://www.springframework.org/schema/beans http://www.springframework.org/schema/beans/spring-beans.xsd\n'
        '                                 http://www.springframework.org/schema/security http://www.springframework.org/schema/security/spring-security.xsd">\n\n'
        '    <!-- 정산 화면(.do) 접근 제어 -->\n    <http pattern="/settle/**" use-expressions="true">\n' + xml + '        <form-login login-page="/login.do"/>\n    </http>\n</beans:beans>\n')
    f['abt-app/src/main/resources/application.yml'] = ('spring:\n  application:\n    name: abt-platform\n  datasource:\n    url: jdbc:h2:mem:abt\n  jpa:\n    hibernate:\n      ddl-auto: validate\nabt:\n  pg:\n    url: https://pg.example.invalid\n  issuer:\n    url: https://issuer.example.invalid\n')
    return f


def test_files(m: Model) -> dict[str, str]:
    f = {}
    f['abt-account/src/test/java/kr/example/abt/account/controller/AccountControllerTest.java'] = f'''package {ROOT_PKG}.account.controller;

import org.junit.jupiter.api.Test;

class AccountControllerTest {{

    @Test
    void getAccountPathIsStable() {{
        String path = "/api/v1/accounts/1";
        org.junit.jupiter.api.Assertions.assertTrue(path.startsWith("/api/v1/accounts"));
    }}
}}
'''
    f['abt-account/src/test/java/kr/example/abt/account/support/FakeLegacyController.java'] = f'''package {ROOT_PKG}.account.support;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 통합 테스트에서 외부 호출을 흉내 내는 가짜 컨트롤러. 운영 코드가 아니다. */
@RestController
@RequestMapping("/api/v1/legacy")
public class FakeLegacyController {{

    @GetMapping("/ping")
    public String ping() {{
        return "pong";
    }}
}}
'''
    return f


# ------------------------------------------------------------------ maven
def poms(m: Model) -> dict[str, str]:
    mods = ['common', 'account', 'tap', 'fare', 'billing', 'settlement', 'partner', 'admin']
    parent = f'''<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>{SPRING_BOOT}</version>
        <relativePath/>
    </parent>
    <groupId>kr.example.abt</groupId>
    <artifactId>abt-platform</artifactId>
    <version>1.0.0-SNAPSHOT</version>
    <packaging>pom</packaging>
    <name>ABT Platform (synthetic)</name>
    <properties>
        <java.version>17</java.version>
        <spring-cloud.version>{CLOUD}</spring-cloud.version>
    </properties>
    <modules>
{''.join(f'        <module>abt-{x}</module>' + chr(10) for x in mods)}        <module>abt-app</module>
    </modules>
    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.springframework.cloud</groupId>
                <artifactId>spring-cloud-dependencies</artifactId>
                <version>${{spring-cloud.version}}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>
    <dependencies>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-validation</artifactId></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-security</artifactId></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-oauth2-resource-server</artifactId></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>
        <dependency><groupId>org.springframework.cloud</groupId><artifactId>spring-cloud-starter-openfeign</artifactId></dependency>
        <dependency><groupId>org.projectlombok</groupId><artifactId>lombok</artifactId><scope>provided</scope></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
    </dependencies>
</project>
'''
    out = {'pom.xml': parent}
    for x in mods:
        dep = '' if x == 'common' else '        <dependency><groupId>kr.example.abt</groupId><artifactId>abt-common</artifactId><version>${project.version}</version></dependency>\n'
        out[f'abt-{x}/pom.xml'] = (f'<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0">\n    <modelVersion>4.0.0</modelVersion>\n'
                                   f'    <parent><groupId>kr.example.abt</groupId><artifactId>abt-platform</artifactId><version>1.0.0-SNAPSHOT</version></parent>\n'
                                   f'    <artifactId>abt-{x}</artifactId>\n    <dependencies>\n{dep}    </dependencies>\n</project>\n')
    deps = ''.join(f'        <dependency><groupId>kr.example.abt</groupId><artifactId>abt-{x}</artifactId><version>${{project.version}}</version></dependency>\n' for x in mods)
    out['abt-app/pom.xml'] = ('<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0">\n    <modelVersion>4.0.0</modelVersion>\n'
                              '    <parent><groupId>kr.example.abt</groupId><artifactId>abt-platform</artifactId><version>1.0.0-SNAPSHOT</version></parent>\n'
                              f'    <artifactId>abt-app</artifactId>\n    <dependencies>\n{deps}    </dependencies>\n</project>\n')
    return out


# ------------------------------------------------------------------ whole project
def emit_all(m: Model) -> dict[str, str]:
    files: dict[str, str] = {}
    ENUM_MODULES.clear()
    ENUM_MODULES.update(e.module for e in m.enums.values())
    files.update(poms(m))
    files.update(common_files(m))
    files.update(feign_files(m))
    files.update(logic_files(m))
    files.update(config_files(m))
    files.update(test_files(m))
    for d in m.dtos.values():
        p, s = emit_dto(m, d)
        files[p] = s
    for e in m.enums.values():
        p, s = emit_enum(e)
        files[p] = s
    for c in m.ctrls.values():
        p, s = emit_controller(m, c)
        files[p] = s
    files.update(dict([emit_abstract_lookup()]))
    modules = sorted({c.module for c in m.ctrls.values()})
    for mod in modules:
        for agg, flds in aggregates(m, mod).items():
            p, s = emit_entity(m, mod, agg, flds)
            files[p] = s
            p, s = emit_repository(mod, agg)
            files[p] = s
        for svc in sorted({c.service for c in m.ctrls.values() if c.module == mod}):
            p, s = emit_service_iface(m, mod, svc)
            files[p] = s
            p, s = emit_service_impl(m, mod, svc)
            files[p] = s
    files['.gitignore'] = 'target/\n*.class\n'
    files['README.md'] = '# ABT Platform (synthetic)\n\n교통 계정 기반 승차권(ABT) 요금·결제·정산 플랫폼. **실험용 가상 시스템**이며 실제 시스템·사업자와 무관합니다.\n'
    return files
