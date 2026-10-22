import type { InterfaceSpecIssue } from '../docs/interface-spec.js';
import type { ScreenSpecIssue } from '../docs/screen-spec.js';

export type StructuredDocumentKind = 'interface-spec' | 'screen-spec';
/** `export-openapi` applies to interface specs only and writes an OpenAPI 3.1 JSON file. */
export type StructuredDocumentRenderAction = 'preview' | 'export' | 'export-openapi';

export interface StructuredDocumentRenderRequest {
  inputFile: string;
  action: StructuredDocumentRenderAction;
}

export interface StructuredDocumentRenderResponse {
  ok: true;
  kind: StructuredDocumentKind;
  action: StructuredDocumentRenderAction;
  inputFile: string;
  outputFile: string;
  outputUrl: string;
  itemCount: number;
  issues: Array<InterfaceSpecIssue | ScreenSpecIssue>;
  /** Values the export could not represent exactly (OpenAPI export only). */
  warnings?: string[];
}

export interface StructuredDocumentRenderErrorResponse {
  ok: false;
  code:
    | 'PROJECT_NOT_FOUND'
    | 'DOCUMENT_NOT_FOUND'
    | 'INVALID_DOCUMENT'
    | 'DOCUMENT_VALIDATION_FAILED'
    | 'DOCUMENT_RENDER_FAILED';
  message: string;
  issues?: Array<InterfaceSpecIssue | ScreenSpecIssue>;
}
