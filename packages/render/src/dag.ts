import type { RenderDag, RenderDagNode } from "./contracts.js";

export const validateRenderDag = (dag: RenderDag): readonly RenderDagNode[] => {
  if (dag.nodes.length === 0 || dag.nodes.length > 100_000) {
    throw new Error("Render DAG node count is outside bounded limits.");
  }
  const start = BigInt(dag.range.startFrame);
  const end = BigInt(dag.range.endFrameExclusive);
  if (start < 0n || end <= start) throw new Error("Render DAG range must be non-empty and half-open.");
  const byId = new Map<string, RenderDagNode>();
  for (const node of dag.nodes) {
    if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(node.id) || byId.has(node.id)) {
      throw new Error(`Render DAG node ID is invalid or duplicated: ${node.id}.`);
    }
    if (node.dependsOn.includes(node.id) || new Set(node.dependsOn).size !== node.dependsOn.length) {
      throw new Error(`Render DAG node ${node.id} has invalid dependencies.`);
    }
    if (
      node.resources.cpu <= 0 ||
      node.resources.memoryMiB < 16 ||
      node.retryPolicy.maxAttempts < 1 ||
      node.retryPolicy.maxAttempts > 10
    ) {
      throw new Error(`Render DAG node ${node.id} has invalid resource or retry bounds.`);
    }
    byId.set(node.id, node);
  }
  for (const node of dag.nodes) {
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) throw new Error(`Render DAG node ${node.id} has a missing dependency.`);
    }
  }
  for (const root of dag.roots) if (!byId.has(root)) throw new Error(`Render DAG root ${root} is missing.`);
  const state = new Map<string, "visiting" | "visited">();
  const ordered: RenderDagNode[] = [];
  const visit = (node: RenderDagNode): void => {
    if (state.get(node.id) === "visiting") throw new Error(`Render DAG contains a cycle at ${node.id}.`);
    if (state.get(node.id) === "visited") return;
    state.set(node.id, "visiting");
    for (const dependency of node.dependsOn) visit(requireNode(byId, dependency));
    state.set(node.id, "visited");
    ordered.push(node);
  };
  for (const node of dag.nodes) visit(node);
  const reachable = new Set<string>();
  const mark = (id: string): void => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const dependency of requireNode(byId, id).dependsOn) mark(dependency);
  };
  for (const root of dag.roots) mark(root);
  if (reachable.size !== dag.nodes.length) throw new Error("Render DAG contains unreachable nodes.");
  return ordered;
};

const requireNode = (nodes: ReadonlyMap<string, RenderDagNode>, id: string): RenderDagNode => {
  const node = nodes.get(id);
  if (node === undefined) throw new Error(`Render DAG node ${id} is missing.`);
  return node;
};
