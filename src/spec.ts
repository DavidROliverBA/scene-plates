// The spec a model (or a person) writes. Everything else is derived.

export type NodeKind = 'process' | 'gate' | 'fail' | 'success' | 'quiet';
export type EdgeKind = 'flow' | 'pass' | 'fail' | 'loop' | 'quiet';

export interface NodeSpec {
  id: string;
  label: string;
  sub?: string;
  kind?: NodeKind; // default process
  at: [number, number]; // [column, row] of the back-left corner, in grid units
  size?: [number, number]; // [width, depth], default [2, 1]
  layer?: number; // 0 is the bottom layer
}

export interface GroupSpec {
  id: string;
  label?: string;
  contains: string[]; // node ids or other group ids (plates nest), all on one layer
}

export interface EdgeSpec {
  id?: string; // default "from>to"
  from: string;
  to: string;
  kind?: EdgeKind; // default flow
  label?: string;
  via?: 'x' | 'y' | 'xy' | 'yx'; // which way to leave the source first
  channel?: number; // column or row of the middle segment
  offset?: number; // shift sideways, for a pair of edges between the same nodes
  flip?: boolean; // put the label on the other side
  hold?: boolean; // stay hidden until a step shows it by id
}

export interface CameraSpec {
  yaw?: number;
  pitch?: number;
  zoom?: number;
  target?: string[] | null; // centre on these; null goes back to the whole scene
}

export interface StepSpec {
  caption?: string;
  show?: string[]; // node, group or held-edge ids; stays shown
  hide?: string[];
  focus?: string[]; // this step only: everything else dims
  pulse?: string[]; // this step only: edge ids that carry a moving dot
  camera?: CameraSpec; // stays until changed
}

export type View = 'iso' | 'flat';

export interface Spec {
  title: string;
  view?: View; // iso (default) is the 3D view; flat is the same scene seen from straight above
  description: string; // read out by screen readers: say what the diagram shows
  camera?: CameraSpec;
  nodes: NodeSpec[];
  groups?: GroupSpec[];
  edges?: EdgeSpec[];
  steps?: StepSpec[];
}

export const NODE_KINDS: NodeKind[] = ['process', 'gate', 'fail', 'success', 'quiet'];
export const EDGE_KINDS: EdgeKind[] = ['flow', 'pass', 'fail', 'loop', 'quiet'];
