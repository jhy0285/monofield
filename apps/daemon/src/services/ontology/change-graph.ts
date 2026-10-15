import type {
  CodeOntologyPlanResponse,
  CodeOntologyResponse,
  DocumentGraphResponse,
  ChangePlanResponse,
} from "@open-design/contracts";
import type { GraphDocument } from "../document-graph.js";
import { RecordedDependencyGraph } from './recorded-graph.js';

/** Join exact source paths and unique literal API contracts. Ambiguities stay visible. */
export function mergeOntologyDocuments(
  ontology: CodeOntologyResponse,
  documents: DocumentGraphResponse,
  specs: GraphDocument[],
): DocumentGraphResponse {
  const prefix = ontology.projectPath === "." ? "" : ontology.projectPath + "/";
  const code = ontology.dependencyGraph;
  const nodes = new Map(
    code.nodes.map((node) => [
      node.id,
      {
        ...node,
        label: node.kind === "code" ? prefix + node.label : node.label,
        ...(node.documentFile
          ? { documentFile: prefix + node.documentFile }
          : {}),
      },
    ]),
  );
  const sourceFiles = new Map(
    [...nodes.values()]
      .filter((node) => node.kind === "code")
      .map((node) => [node.label, node.id]),
  );
  const aliases = new Map<string, string>();
  for (const node of documents.nodes) {
    const existing =
      node.kind === "code" ? sourceFiles.get(node.label) : undefined;
    if (existing) aliases.set(node.id, existing);
    else nodes.set(node.id, node);
  }
  const alias = (id: string) => aliases.get(id) ?? id;
  const edges = [
    ...code.edges.map((edge) => ({
      ...edge,
      documentFile: prefix + edge.documentFile,
    })),
    ...documents.edges.map((edge) => ({
      ...edge,
      sourceId: alias(edge.sourceId),
      dependentId: alias(edge.dependentId),
    })),
  ];
  const warnings = [...code.warnings, ...documents.warnings];
  for (const { file, doc } of specs)
    if (doc.kind === "interface-spec")
      for (const endpoint of doc.endpoints) {
        const declared = ontology.nodes.filter(
          (node) =>
            node.kind === "api" &&
            node.api?.method === endpoint.method &&
            node.api.path === endpoint.path,
        );
        const dependent = documents.nodes.find(
          (node) =>
            node.kind === "api" &&
            node.documentFile === file &&
            node.itemId ===
              (endpoint.interfaceId || `${endpoint.method} ${endpoint.path}`),
        );
        if (declared.length === 1 && dependent)
          edges.push({
            dependentId: dependent.id,
            sourceId: declared[0]!.id,
            documentFile: file,
            evidenceRef: `Unique literal ${endpoint.method} ${endpoint.path} source declaration at ${prefix}${declared[0]!.evidence.path}:${declared[0]!.evidence.line}; static candidate, runtime contract requires review`,
          });
        else
          warnings.push(
            `API documentation pairing needs review: ${file}#${endpoint.interfaceId}: ${declared.length} exact source contracts`,
          );
      }
  const distinctEdges = [
    ...new Map(
      edges.map((edge) => [
        JSON.stringify([
          edge.dependentId,
          edge.sourceId,
          edge.documentFile,
          edge.evidenceRef,
        ]),
        edge,
      ]),
    ).values(),
  ];
  if (nodes.size > 20000 || distinctEdges.length > 50000)
    throw new Error(
      "Combined change graph exceeds its node/edge limits; select a smaller module",
    );
  const linked = new Set(distinctEdges.map((edge) => edge.dependentId));
  return {
    ok: true,
    analyzedAt: new Date().toISOString(),
    documents: documents.documents,
    nodes: [...nodes.values()],
    edges: distinctEdges,
    changedNodeIds: [
      ...new Set([
        ...code.changedNodeIds,
        ...documents.changedNodeIds.map(alias),
      ]),
    ],
    impacts: [],
    unlinkedNodeIds: [...nodes.values()]
      .filter(
        (node) =>
          (node.kind === "api" || node.kind === "screen") &&
          !linked.has(node.id),
      )
      .map((node) => node.id),
    warnings: [...new Set(warnings)],
    schemaWatch: documents.schemaWatch,
  };
}

export function documentReviews(
  plan: ChangePlanResponse,
  ontology: CodeOntologyResponse,
  graphIndex = new RecordedDependencyGraph(plan.graph),
): CodeOntologyPlanResponse["documentReviews"] {
  const specs = new Set(plan.graph.documents);
  const nodes = new Map(plan.graph.nodes.map((node) => [node.id, node]));
  const unavailable = new Set(
    ontology.issues
      .filter((issue) =>
        ["unsupported-language", "parse-error", "excluded-file"].includes(
          issue.reason,
        ),
      )
      .map((issue) => issue.path),
  );
  const sourceIds = ontology.coverage.truncated
    ? []
    : ontology.dependencyGraph.nodes
        .filter((node) => node.kind === "code" && !unavailable.has(node.label))
        .map((node) => node.id);
  const linked = graphIndex.reachableFrom(sourceIds);
  return plan.graph.nodes
    .filter(
      (node) =>
        !!node.documentFile &&
        specs.has(node.documentFile) &&
        (node.kind === "api" || node.kind === "screen"),
    )
    .map((node) => {
      const impacted = plan.affectedNodeIds.includes(node.id);
      const chain =
        plan.obligations.find((item) => item.nodeId === node.id)?.path ?? [];
      return {
        documentFile: node.documentFile!,
        itemId: node.itemId ?? "",
        label: node.label,
        state: impacted
          ? ("review-required" as const)
          : !plan.source.digest || !linked.has(node.id)
            ? ("coverage-unknown" as const)
            : ("no-recorded-impact" as const),
        impactPath: chain.map((id) => nodes.get(id)?.label ?? id),
      };
    });
}
