import type { InterfaceSpecIssue } from '../docs/interface-spec.js';
import type { ScreenSpecIssue } from '../docs/screen-spec.js';

export type StructuredDocumentKind = 'interface-spec' | 'screen-spec';
export type StructuredDocumentRenderAction = 'preview' | 'export';

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
