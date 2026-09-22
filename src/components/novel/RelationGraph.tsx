'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Character, CharacterRelation, RelationKind } from '@/lib/types';

/**
 * 角色关系网状图。
 *
 * 布局采用自实现的力导向算法：节点之间互斥，存在关系的节点互相吸引，
 * 并施加指向中心的弱约束，避免整图漂移。
 * 节点位置保存在 React 状态中，物理迭代在每一帧推进一次并写回状态；
 * 系统动能连续若干帧低于阈值即判定稳定并停止迭代，避免长期占用渲染线程。
 * 支持拖动节点、滚轮缩放、双击复位，点击节点可联动右侧信息面板。
 */

interface NodeState {
  id: string;
  name: string;
  emoji: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

interface DragState {
  /** 正在被拖动的节点标识，为空表示没有拖动 */
  id: string | null;
  x: number;
  y: number;
}

const WIDTH = 960;
const HEIGHT = 620;
const REPULSION = 26000;
const SPRING = 0.012;
const DAMPING = 0.86;
const CENTER_PULL = 0.0016;
const PADDING_X = 52;
const PADDING_Y = 42;
const ENERGY_THRESHOLD = 0.6;
const STILL_FRAMES_TO_STOP = 30;

export const KIND_COLOR: Record<RelationKind, string> = {
  family: '#c2410c',
  lover: '#be123c',
  friend: '#15803d',
  rival: '#a16207',
  enemy: '#b3261e',
  mentor: '#7c3aed',
  subordinate: '#0369a1',
  ally: '#0f766e',
  other: '#8e9096',
};

/** 生成初始布局：按圆周均匀分布，使首次迭代不会全部挤在中心。 */
function seedNodes(characters: Character[], relations: CharacterRelation[]): NodeState[] {
  const degree = new Map<string, number>();
  for (const relation of relations) {
    degree.set(relation.fromCharacterId, (degree.get(relation.fromCharacterId) ?? 0) + 1);
    degree.set(relation.toCharacterId, (degree.get(relation.toCharacterId) ?? 0) + 1);
  }
  const count = Math.max(1, characters.length);
  return characters.map((character, index) => {
    const angle = (index / count) * Math.PI * 2;
    const radius = Math.min(WIDTH, HEIGHT) * 0.32;
    return {
      id: character.id,
      name: character.name,
      emoji: character.emoji,
      x: WIDTH / 2 + Math.cos(angle) * radius,
      y: HEIGHT / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      degree: degree.get(character.id) ?? 0,
    };
  });
}

/** 单帧物理推进。返回新的节点位置与系统动能。 */
function simulate(
  input: NodeState[],
  relations: CharacterRelation[],
  drag: DragState,
): { nodes: NodeState[]; energy: number } {
  const nodes = input.map((node) => ({ ...node }));
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));

  // 节点互斥
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < 1) {
        dx = (Math.random() - 0.5) * 2;
        dy = (Math.random() - 0.5) * 2;
        distanceSquared = 1;
      }
      const distance = Math.sqrt(distanceSquared);
      const force = REPULSION / distanceSquared;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  // 关系边充当弹簧，关系越密切静止距离越短
  for (const relation of relations) {
    const fromIndex = indexById.get(relation.fromCharacterId);
    const toIndex = indexById.get(relation.toCharacterId);
    if (fromIndex === undefined || toIndex === undefined) continue;
    const a = nodes[fromIndex]!;
    const b = nodes[toIndex]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const restLength = 180 - Math.min(90, relation.strength * 14);
    const force = (distance - restLength) * SPRING;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  let energy = 0;
  for (const node of nodes) {
    if (drag.id === node.id) {
      // 被拖动的节点直接跟随指针，并清零速度
      node.x = drag.x;
      node.y = drag.y;
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx += (WIDTH / 2 - node.x) * CENTER_PULL;
    node.vy += (HEIGHT / 2 - node.y) * CENTER_PULL;
    node.vx *= DAMPING;
    node.vy *= DAMPING;
    node.x = Math.max(PADDING_X, Math.min(WIDTH - PADDING_X, node.x + node.vx));
    node.y = Math.max(PADDING_Y, Math.min(HEIGHT - PADDING_Y, node.y + node.vy));
    energy += Math.abs(node.vx) + Math.abs(node.vy);
  }

  return { nodes, energy };
}

export function RelationGraph({
  characters,
  relations,
  onSelect,
  selectedId,
  onOpenDossier,
}: {
  characters: Character[];
  relations: CharacterRelation[];
  onSelect: (characterId: string) => void;
  selectedId?: string;
  onOpenDossier?: (characterId: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState>({ id: null, x: 0, y: 0 });
  const panRef = useRef<{ clientX: number; clientY: number; originX: number; originY: number } | null>(
    null,
  );

  const [nodes, setNodes] = useState<NodeState[]>(() => seedNodes(characters, relations));
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [seedNonce, setSeedNonce] = useState(0);

  const relationsKey = useMemo(
    () => relations.map((relation) => `${relation.id}:${relation.strength}`).join('|'),
    [relations],
  );
  const charactersKey = useMemo(
    () => characters.map((character) => `${character.id}:${character.name}`).join('|'),
    [characters],
  );

  // 初始化与物理迭代。角色或关系发生变化时重新布局。
  useEffect(() => {
    let running = true;
    let frame = 0;
    let stillFrames = 0;
    let current = seedNodes(characters, relations);
    dragRef.current = { id: null, x: 0, y: 0 };
    setNodes(current);

    const step = () => {
      if (!running) return;
      const result = simulate(current, relations, dragRef.current);
      current = result.nodes;
      setNodes(current);

      stillFrames = result.energy < ENERGY_THRESHOLD ? stillFrames + 1 : 0;
      if (stillFrames > STILL_FRAMES_TO_STOP) return;
      frame = window.requestAnimationFrame(step);
    };

    frame = window.requestAnimationFrame(step);
    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };
    // 依赖使用序列化后的键，避免数组引用变化导致布局反复重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charactersKey, relationsKey, seedNonce]);

  const toLocal = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
      const viewX = ((clientX - rect.left) / rect.width) * WIDTH;
      const viewY = ((clientY - rect.top) / rect.height) * HEIGHT;
      return { x: (viewX - offset.x) / scale, y: (viewY - offset.y) / scale };
    },
    [offset.x, offset.y, scale],
  );

  const handleNodePointerDown = (event: React.PointerEvent, nodeId: string) => {
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    const local = toLocal(event.clientX, event.clientY);
    dragRef.current = { id: nodeId, x: local.x, y: local.y };
    setNodes((current) =>
      current.map((node) => (node.id === nodeId ? { ...node, vx: 0, vy: 0 } : node)),
    );
    onSelect(nodeId);
  };

  const handleCanvasPointerDown = (event: React.PointerEvent) => {
    panRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (dragRef.current.id) {
      const local = toLocal(event.clientX, event.clientY);
      dragRef.current = { ...dragRef.current, x: local.x, y: local.y };
      setNodes((current) =>
        current.map((node) =>
          node.id === dragRef.current.id ? { ...node, x: local.x, y: local.y } : node,
        ),
      );
      return;
    }
    const pan = panRef.current;
    if (pan) {
      setOffset({
        x: pan.originX + (event.clientX - pan.clientX),
        y: pan.originY + (event.clientY - pan.clientY),
      });
    }
  };

  const handlePointerUp = () => {
    dragRef.current = { id: null, x: 0, y: 0 };
    panRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    setScale((current) => Math.max(0.4, Math.min(2.4, current * (event.deltaY > 0 ? 0.92 : 1.08))));
  };

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setSeedNonce((value) => value + 1);
  };

  if (characters.length === 0) {
    return <p className="text-sm text-ink-faint">还没有角色，添加角色后关系网会自动生成。</p>;
  }

  const positionOf = (id: string) => nodes.find((node) => node.id === id);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn px-2 py-1 text-xs" onClick={resetView}>
          <i className="fa-solid fa-crosshairs" aria-hidden />
          复位布局
        </button>
        <span className="text-xs text-ink-faint">
          {nodes.length} 个角色 · {relations.length} 条关系 · 缩放 {Math.round(scale * 100)}%
        </span>
        {selectedId ? (
          <span className="chip chip-accent ml-auto">
            {positionOf(selectedId)?.name ?? '已选中'}
          </span>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-[10px] border border-line bg-surface-raised">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-[32rem] w-full touch-none select-none"
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
          onDoubleClick={resetView}
        >
          <defs>
            <marker
              id="relation-arrow"
              viewBox="0 0 10 10"
              refX="16"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#8e9096" />
            </marker>
          </defs>

          <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
            {relations.map((relation) => {
              const from = positionOf(relation.fromCharacterId);
              const to = positionOf(relation.toCharacterId);
              if (!from || !to) return null;
              const color = KIND_COLOR[relation.kind];
              const highlighted = !selectedId || selectedId === from.id || selectedId === to.id;
              return (
                <g key={relation.id} opacity={highlighted ? 1 : 0.22}>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={color}
                    strokeWidth={Math.max(1, relation.strength * 0.7)}
                    strokeDasharray={relation.bidirectional ? undefined : '6 4'}
                    markerEnd="url(#relation-arrow)"
                    opacity={0.72}
                  />
                  {relation.label ? (
                    <text
                      x={(from.x + to.x) / 2}
                      y={(from.y + to.y) / 2 - 5}
                      textAnchor="middle"
                      fontSize={11}
                      fill={color}
                    >
                      {relation.label}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {nodes.map((node) => {
              const isSelected = selectedId === node.id;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className="cursor-pointer"
                  onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onOpenDossier?.(node.id);
                  }}
                >
                  <circle
                    r={isSelected ? 27 : 23}
                    fill={isSelected ? 'var(--accent-soft)' : 'var(--surface-raised)'}
                    stroke={isSelected ? 'var(--accent)' : 'var(--line-strong)'}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    className="transition-all duration-200"
                  />
                  <text textAnchor="middle" y={5} fontSize={17}>
                    {node.emoji}
                  </text>
                  <text
                    textAnchor="middle"
                    y={40}
                    fontSize={12}
                    fill="var(--text)"
                    className={clsx(isSelected && 'font-semibold')}
                  >
                    {node.name.length > 8 ? `${node.name.slice(0, 8)}…` : node.name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(KIND_COLOR) as RelationKind[]).map((kind) => (
          <span key={kind} className="chip">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: KIND_COLOR[kind] }}
            />
            {kind}
          </span>
        ))}
      </div>
    </div>
  );
}
