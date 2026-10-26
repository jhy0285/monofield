import { describe, expect, it } from 'vitest';
import { interfaceSpecToOpenApi, InterfaceSpecDocumentSchema } from '../src/index.js';

const doc = InterfaceSpecDocumentSchema.parse({
  schemaVersion: 1,
  kind: 'interface-spec',
  cover: { docName: '주문 시스템 인터페이스 명세서', version: '1.1', department: '주문서비스팀' },
  source: { codebaseName: 'legacy-order' },
  auth: { type: 'bearer', description: '인증 헤더' },
  endpoints: [
    {
      method: 'POST', path: '/api/v1/orders', interfaceId: 'IF-ORD-001', interfaceName: '주문 등록',
      moduleName: 'orders', handlerName: 'createOrder', authRequired: true, requestBodyType: 'OrderCreateRequest',
      requestFields: [
        { nameEn: 'memberId', nameKo: '회원 ID', dataType: 'Long', required: 'Y', path: 'memberId' },
        { nameEn: 'items', nameKo: '주문상품목록', dataType: 'List<OrderItemRequest>', required: 'Y', path: 'items' },
        { nameEn: 'productId', nameKo: '상품 ID', dataType: 'Long', required: 'Y', path: 'items.productId', parentPath: 'items', depth: 1 },
        { nameEn: 'deliveryMemo', nameKo: '배송요청사항', dataType: 'String', required: 'N', maxSize: '200', path: 'deliveryMemo' },
      ],
      responseType: 'OrderResponse',
      responseFields: [
        { nameEn: 'orderId', nameKo: '주문 ID', dataType: 'Long', required: 'Y' },
        { nameEn: 'orderedAt', nameKo: '주문일시', dataType: 'LocalDateTime', required: 'TBD' },
      ],
    },
    {
      method: 'GET', path: '/api/v1/orders/{orderId}', interfaceId: 'IF-ORD-002', interfaceName: '주문 단건 조회',
      handlerName: 'getOrder', authRequired: true,
      requestFields: [{ nameEn: 'orderId', nameKo: '주문 ID', dataType: 'Long', required: 'Y', note: 'path variable' }],
      responseType: 'List<OrderResponse>',
      responseFields: [{ nameEn: 'orderId', dataType: 'Long', required: 'Y' }],
    },
    {
      method: 'GET/POST', path: '/board/selectBoardList.do', interfaceName: '게시글 목록을 조회한다',
      handlerName: 'selectBoardList', queryDtoType: 'BoardDefaultVO', note: '@RequestMapping에 method가 없어 모든 HTTP 메서드를 허용',
      requestFields: [{ nameEn: 'searchKeyword', nameKo: '검색어', dataType: 'String', required: 'N' }],
    },
    { method: 'PUBLISH', path: 'orders.created', interfaceName: '주문 생성 이벤트' },
  ],
});

describe('interface spec → OpenAPI 3.1', () => {
  const { document, warnings } = interfaceSpecToOpenApi(doc);
  const paths = document.paths as Record<string, Record<string, any>>;

  it('carries the cover, auth scheme and operation identity', () => {
    expect(document).toMatchObject({
      openapi: '3.1.0',
      info: { title: '주문 시스템 인터페이스 명세서', version: '1.1', 'x-department': '주문서비스팀' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    });
    const create = paths['/api/v1/orders']!.post;
    expect(create).toMatchObject({
      summary: '주문 등록', operationId: 'createOrder', tags: ['orders'], 'x-interface-id': 'IF-ORD-001',
      security: [{ bearerAuth: [] }],
    });
  });

  it('nests dot-path request fields into a JSON body schema', () => {
    const schema = paths['/api/v1/orders']!.post.requestBody.content['application/json'].schema;
    expect(schema).toEqual({
      type: 'object',
      required: ['memberId', 'items'],
      properties: {
        memberId: { type: 'integer', format: 'int64', title: '회원 ID' },
        items: {
          type: 'array',
          title: '주문상품목록',
          items: { type: 'object', required: ['productId'], properties: { productId: { type: 'integer', format: 'int64', title: '상품 ID' } } },
        },
        deliveryMemo: { type: 'string', title: '배송요청사항', maxLength: 200 },
      },
    });
    const response = paths['/api/v1/orders']!.post.responses['200'].content['application/json'].schema;
    expect(response.required).toEqual(['orderId']);
    expect(response.properties.orderedAt).toEqual({ type: 'string', format: 'date-time', title: '주문일시', 'x-required': 'TBD' });
  });

  it('maps path variables and list responses', () => {
    const get = paths['/api/v1/orders/{orderId}']!.get;
    expect(get.parameters).toEqual([
      { name: 'orderId', in: 'path', required: true, description: '주문 ID', schema: { type: 'integer', format: 'int64', title: '주문 ID' } },
    ]);
    expect(get.requestBody).toBeUndefined();
    expect(get.responses['200'].content['application/json'].schema.type).toBe('array');
  });

  it('expands method-less mappings and binds form objects as query parameters', () => {
    const board = paths['/board/selectBoardList.do']!;
    expect(Object.keys(board)).toEqual(['get', 'post']);
    expect(board.get.operationId).toBe('selectBoardList');
    expect(board.post.operationId).toBe('selectBoardList_post');
    for (const operation of [board.get, board.post]) {
      expect(operation.parameters).toEqual([
        { name: 'searchKeyword', in: 'query', required: false, description: '검색어', schema: { type: 'string', title: '검색어' } },
      ]);
      expect(operation.requestBody).toBeUndefined();
      expect(operation.security).toEqual([]);
    }
  });

  it('skips non-HTTP channels with a warning', () => {
    expect(paths['orders.created']).toBeUndefined();
    expect(warnings).toEqual([expect.stringContaining('"PUBLISH" is not an HTTP method')]);
  });

  it('never exports an auth-required operation without a known scheme as public', () => {
    const undecided = InterfaceSpecDocumentSchema.parse({
      ...doc, auth: undefined,
      endpoints: [
        { method: 'POST', path: '/board/insertBoard.do', authRequired: true },
        { method: 'GET', path: '/manual', authRequired: true, auth: { type: 'undecided' } },
        { method: 'GET', path: '/signed', authRequired: true, auth: { type: 'custom' } },
        { method: 'GET', path: '/public', authRequired: false },
      ],
    });
    const result = interfaceSpecToOpenApi(undecided);
    const ops = result.document.paths as Record<string, Record<string, any>>;
    for (const operation of [ops['/board/insertBoard.do']!.post, ops['/manual']!.get, ops['/signed']!.get]) {
      // `security: []` would declare the operation public; leave it out and flag the gap instead.
      expect(operation).not.toHaveProperty('security');
      expect(operation['x-auth-undecided']).toBe(true);
    }
    expect(ops['/public']!.get.security).toEqual([]);
    expect(ops['/public']!.get).not.toHaveProperty('x-auth-undecided');
    expect(result.warnings).toEqual([
      expect.stringContaining('POST /board/insertBoard.do: authentication is required but the scheme is undecided'),
      expect.stringContaining('GET /manual: authentication is required but the scheme is undecided'),
      expect.stringContaining('GET /signed: authentication is required but the scheme is undecided'),
    ]);
    expect(result.document.components).toBeUndefined();
  });

  it('keeps an undecided endpoint out of the document-level scheme', () => {
    const mixed = InterfaceSpecDocumentSchema.parse({
      ...doc,
      endpoints: [
        { method: 'GET', path: '/api/products/{productId}/cost', authRequired: true },
        { method: 'GET', path: '/api/products/{productId}/stock', authRequired: true, auth: { type: 'undecided' } },
      ],
    });
    const { document: exported } = interfaceSpecToOpenApi(mixed);
    const ops = exported.paths as Record<string, Record<string, any>>;
    expect(ops['/api/products/{productId}/cost']!.get.security).toEqual([{ bearerAuth: [] }]);
    expect(ops['/api/products/{productId}/cost']!.get).not.toHaveProperty('x-auth-undecided');
    expect(ops['/api/products/{productId}/stock']!.get).not.toHaveProperty('security');
    expect(ops['/api/products/{productId}/stock']!.get['x-auth-undecided']).toBe(true);
    expect(exported).not.toHaveProperty('security');
  });
});
