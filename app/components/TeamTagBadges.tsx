"use client";

import { CheckOutlined, CloseOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Input, Popover } from "antd";
import { useMemo, useState } from "react";
import { readableTagTextColor } from "../settings";
import { resolveTeamTags, teamTagLabel, type ResolvedTeamTag, type TeamTag } from "../team-tags";
import type { TeamNameGroup, TeamNameIndex } from "../team-aliases";
import type { MatchItem } from "../types";

function TeamTagDetails({
  items,
  onSave,
}: {
  items: ResolvedTeamTag[];
  onSave: (tagId: string, memberId: string, note: string, expectedRevision: number) => Promise<TeamTag>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (item: ResolvedTeamTag, memberId: string, revision: number) => {
    setSaving(true);
    setError("");
    try {
      await onSave(item.tag.id, memberId, draft, revision);
      setEditingId(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "球队备注保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="team-tag-popover-content">
      {items.map((item) => (
        <section className="team-tag-popover-section" key={item.tag.id}>
          <div className="team-tag-popover-title">
            <i style={{ background: item.tag.color }} />
            <strong>{item.tag.name}</strong>
          </div>
          <div className="team-tag-note-list">
            {item.members.map((member) => editingId === member.id ? (
              <div className="team-tag-note-editor" key={member.id}>
                <small>{member.sourceName}</small>
                <Input.TextArea value={draft} maxLength={2000} autoSize={{ minRows: 2, maxRows: 6 }} disabled={saving} onChange={(event) => setDraft(event.target.value)} />
                <span>
                  <Button size="small" type="text" icon={<CloseOutlined />} disabled={saving} onClick={() => { setEditingId(null); setError(""); }}>取消</Button>
                  <Button size="small" type="primary" icon={<CheckOutlined />} loading={saving} onClick={() => { void save(item, member.id, member.revision); }}>保存</Button>
                </span>
              </div>
            ) : (
              <div className="team-tag-note-row" key={member.id}>
                <div><small>{member.sourceName}</small><p>{member.note || "暂无备注"}</p></div>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  aria-label={`编辑 ${member.sourceName} 的备注`}
                  onClick={() => { setEditingId(member.id); setDraft(member.note); setError(""); }}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
      {error && <div className="team-tag-popover-error" role="alert">{error}</div>}
    </div>
  );
}

export function TeamTagBadges({
  tags,
  teamName,
  match,
  now,
  teamNameIndex,
  teamNameGroups,
  onMemberNoteSave,
}: {
  tags: TeamTag[];
  teamName: string;
  match: MatchItem;
  now: Date;
  teamNameIndex: TeamNameIndex;
  teamNameGroups: TeamNameGroup[];
  onMemberNoteSave: (tagId: string, memberId: string, note: string, expectedRevision: number) => Promise<TeamTag>;
}) {
  const resolved = useMemo(() => resolveTeamTags(tags, teamName, match, now, teamNameIndex, teamNameGroups), [tags, teamName, match, now, teamNameIndex, teamNameGroups]);
  if (resolved.length === 0) return null;
  const visible = resolved.slice(0, 3);
  return (
    <span className="team-tag-badges">
      {visible.map((item) => (
        <Popover
          key={item.tag.id}
          trigger={["hover", "click"]}
          placement="bottom"
          content={<TeamTagDetails items={[item]} onSave={onMemberNoteSave} />}
        >
          <button
            type="button"
            className="team-tag-badge"
            style={{ background: item.tag.color, color: readableTagTextColor(item.tag.color) }}
            aria-label={`${item.tag.name}，查看球队备注`}
          >{teamTagLabel(item.tag)}</button>
        </Popover>
      ))}
      {resolved.length > 3 && (
        <Popover trigger={["hover", "click"]} placement="bottom" content={<TeamTagDetails items={resolved} onSave={onMemberNoteSave} />}>
          <button type="button" className="team-tag-more" aria-label={`查看全部 ${resolved.length} 个球队标签`}>+{resolved.length - 3}</button>
        </Popover>
      )}
    </span>
  );
}
