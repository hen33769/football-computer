"use client";

import { CaretUpOutlined, CopyOutlined, DeleteOutlined, EditOutlined, ImportOutlined, PlusOutlined, ShareAltOutlined } from "@ant-design/icons";
import { App, AutoComplete, Button, Card, ColorPicker, Empty, Input, Modal, Popconfirm, Select, Space, Tag } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { readableTagTextColor } from "../settings";
import { buildTeamNameIndex, normalizeTeamName, type TeamNameGroup } from "../team-aliases";
import { resolveTeamIdentity, teamTagLabel, type TeamTag, type TeamTagDraft, type TeamTagShare } from "../team-tags";

const emptyDraft = (): TeamTagDraft => ({
  name: "",
  shortText: "",
  color: "#1677ff",
  dateBasis: "current",
  startDate: null,
  endDate: null,
  members: [],
});

export function TeamTagSettings({
  tags,
  teamNameGroups,
  onSave,
  onDelete,
  onShare,
  onImport,
}: {
  tags: TeamTag[];
  teamNameGroups: TeamNameGroup[];
  onSave: (draft: TeamTagDraft) => Promise<TeamTag>;
  onDelete: (tag: Pick<TeamTag, "id" | "revision">) => Promise<void>;
  onShare: (tag: Pick<TeamTag, "id" | "revision">) => Promise<TeamTagShare>;
  onImport: (code: string, requestId: string) => Promise<TeamTag>;
}) {
  const { message, notification } = App.useApp();
  const [draft, setDraft] = useState<TeamTagDraft | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareResult, setShareResult] = useState<TeamTagShare | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [importing, setImporting] = useState(false);
  const [teamQuery, setTeamQuery] = useState("");
  const teamIndex = useMemo(() => buildTeamNameIndex(teamNameGroups), [teamNameGroups]);
  const teamOptions = useMemo(() => teamNameGroups.flatMap((group) => {
    const primary = group.names.find((entry) => entry.activeSlot === 1) ?? group.names[0];
    if (!primary) return [];
    const aliases = group.names.filter((entry) => entry.id !== primary.id).map((entry) => entry.name);
    return [{
      value: primary.name,
      label: aliases.length > 0 ? `${primary.name}（${aliases.join("、")}）` : primary.name,
      searchKeys: group.names.map((entry) => normalizeTeamName(entry.name)),
    }];
  }), [teamNameGroups]);
  const suggestedTeams = useMemo(() => {
    const query = normalizeTeamName(teamQuery);
    return (query ? teamOptions.filter((option) => option.searchKeys.some((key) => key.includes(query))) : teamOptions)
      .map(({ value, label }) => ({ value, label }));
  }, [teamOptions, teamQuery]);

  const beginEdit = (tag: TeamTag) => {
    setTeamQuery("");
    setDraft({
      id: tag.id,
      name: tag.name,
      shortText: tag.shortText,
      color: tag.color,
      dateBasis: tag.dateBasis,
      startDate: tag.startDate,
      endDate: tag.endDate,
      expectedRevision: tag.revision,
      members: tag.members.map((member) => ({
        id: member.id,
        sourceName: member.sourceName,
        teamGroupId: member.teamGroupId,
        note: member.note,
        revision: member.revision,
      })),
    });
  };

  const addConfiguredTeam = (rawName: string) => {
    if (!draft) return;
    const manualName = rawName.normalize("NFKC").trim();
    if (!manualName) return;
    const resolution = teamIndex.get(normalizeTeamName(rawName));
    const sourceName = resolution?.activeNames[0]?.name ?? manualName;
    const teamGroupId = resolution?.groupId ?? null;
    const identity = resolveTeamIdentity(sourceName, teamIndex, teamNameGroups, teamGroupId);
    const duplicate = draft.members.find((member) => resolveTeamIdentity(
      member.sourceName,
      teamIndex,
      teamNameGroups,
      member.teamGroupId ?? null,
    ) === identity);
    if (duplicate) {
      message.error(`「${sourceName}」与已添加的「${duplicate.sourceName}」属于同一球队`);
      return;
    }
    setDraft({
      ...draft,
      members: [...draft.members, { sourceName, teamGroupId, note: "" }],
    });
    setTeamQuery("");
  };

  const save = async () => {
    if (!draft || saving) return;
    if (!draft.name.trim() || draft.members.length === 0) {
      message.error(draft.name.trim() ? "至少添加一支球队" : "请输入标签名称");
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setDraft(null);
      notification.success({ title: "球队标签已保存" });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "球队标签保存失败");
    } finally { setSaving(false); }
  };

  const remove = async (tag: TeamTag) => {
    setDeletingId(tag.id);
    try {
      await onDelete(tag);
      if (draft?.id === tag.id) setDraft(null);
      notification.success({ title: "球队标签已删除" });
    } catch (error) { message.error(error instanceof Error ? error.message : "球队标签删除失败"); }
    finally { setDeletingId(null); }
  };

  const share = async (tag: TeamTag) => {
    setSharingId(tag.id);
    try { setShareResult(await onShare(tag)); }
    catch (error) { message.error(error instanceof Error ? error.message : "分享码生成失败"); }
    finally { setSharingId(null); }
  };

  const importTag = async () => {
    if (!importCode.trim()) return;
    setImporting(true);
    try {
      await onImport(importCode.trim(), crypto.randomUUID());
      setImportOpen(false);
      setImportCode("");
      notification.success({ title: "球队标签已导入", description: "已重新加载个人标签配置" });
    } catch (error) { message.error(error instanceof Error ? error.message : "分享码导入失败"); }
    finally { setImporting(false); }
  };

  return (
    <Card className="settings-card team-tag-settings-card">
      <div className="settings-card-head">
        <div><h3>球队标签配置</h3><p>个人配置，仅当前账号可见；通过限时分享码可将单个标签复制给其他账号。</p></div>
        <Space wrap>
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>导入分享码</Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={Boolean(draft)} onClick={() => { setCollapsed(false); setTeamQuery(""); setDraft(emptyDraft()); }}>添加标签</Button>
          <Button
            type="text"
            className={`settings-card-collapse-button${collapsed ? " is-collapsed" : ""}`}
            icon={<CaretUpOutlined />}
            aria-label={collapsed ? "展开球队标签配置" : "折叠球队标签配置"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          />
        </Space>
      </div>
      {!collapsed && <>
      {draft && (
        <div className="team-tag-editor">
          <div className="team-tag-editor-grid">
            <label><span>标签名称</span><Input value={draft.name} maxLength={80} placeholder="例如：26 欧冠" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label><span>卡片文案</span><Input value={draft.shortText} maxLength={2} placeholder="留空取首字符" onChange={(event) => setDraft({ ...draft, shortText: event.target.value })} /></label>
            <label><span>底色</span><ColorPicker value={draft.color} showText disabledAlpha onChangeComplete={(value) => setDraft({ ...draft, color: value.toHexString() })} /></label>
            <label><span>日期参照</span><Select value={draft.dateBasis} options={[{ value: "current", label: "当前日期" }, { value: "match", label: "比赛日期" }]} onChange={(dateBasis) => setDraft({ ...draft, dateBasis })} /></label>
            <label><span>开始日期</span><Input type="date" value={draft.startDate ?? ""} onChange={(event) => setDraft({ ...draft, startDate: event.target.value || null })} /></label>
            <label><span>结束日期</span><Input type="date" value={draft.endDate ?? ""} onChange={(event) => setDraft({ ...draft, endDate: event.target.value || null })} /></label>
          </div>
          <div className="team-tag-team-picker">
            <span>添加队伍</span>
            <div className="team-tag-team-picker-row">
              <AutoComplete
                value={teamQuery}
                options={suggestedTeams}
                filterOption={false}
                aria-label="添加球队"
                placeholder="输入队名或别称，从建议中选择"
                onChange={setTeamQuery}
                onSelect={(value) => addConfiguredTeam(value)}
              />
              <Button icon={<PlusOutlined />} aria-label="添加输入的球队" disabled={!teamQuery.trim()} onClick={() => addConfiguredTeam(teamQuery)}>添加</Button>
            </div>
            <small>建议来自独立的“队伍信息配置”，也可以直接添加手填队名。</small>
          </div>
          <div className="team-tag-member-editor-list">
            {draft.members.map((member, index) => (
              <div className="team-tag-member-editor" key={member.id ?? normalizeTeamName(member.sourceName)}>
                <b>{member.sourceName}</b>
                <Input.TextArea value={member.note} maxLength={2000} autoSize={{ minRows: 1, maxRows: 5 }} placeholder="球队备注（仅属于当前标签）" onChange={(event) => setDraft({ ...draft, members: draft.members.map((item, itemIndex) => itemIndex === index ? { ...item, note: event.target.value } : item) })} />
                <Button type="text" danger icon={<DeleteOutlined />} aria-label={`移除 ${member.sourceName}`} onClick={() => setDraft({ ...draft, members: draft.members.filter((_, itemIndex) => itemIndex !== index) })} />
              </div>
            ))}
          </div>
          <div className="team-tag-editor-actions"><Button disabled={saving} onClick={() => setDraft(null)}>取消</Button><Button type="primary" loading={saving} onClick={() => { void save(); }}>保存</Button></div>
        </div>
      )}
      <div className="team-tag-settings-list">
        {tags.length === 0 && !draft ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有个人球队标签" /> : tags.map((tag) => draft?.id === tag.id ? null : (
          <section className="team-tag-summary" key={tag.id}>
            <div className="team-tag-summary-main">
              <Tag color={tag.color} variant="solid" style={{ color: readableTagTextColor(tag.color) }}>{teamTagLabel(tag)}</Tag>
              <div><b>{tag.name}</b><span>{tag.members.length} 支球队 · {tag.dateBasis === "current" ? "按当前日期" : "按比赛日期"} · {tag.startDate || "不限"} 至 {tag.endDate || "不限"}</span></div>
            </div>
            <Space size="small">
              <Button type="text" icon={<ShareAltOutlined />} loading={sharingId === tag.id} onClick={() => { void share(tag); }}>分享</Button>
              <Button type="text" icon={<EditOutlined />} disabled={Boolean(draft)} onClick={() => beginEdit(tag)}>编辑</Button>
              <Popconfirm title="删除这个个人球队标签？" okText="删除" cancelText="取消" onConfirm={() => { void remove(tag); }}><Button type="text" danger icon={<DeleteOutlined />} loading={deletingId === tag.id} /></Popconfirm>
            </Space>
          </section>
        ))}
      </div>
      </>}
      <Modal title="导入球队标签" open={importOpen} okText="导入" cancelText="取消" confirmLoading={importing} onOk={() => { void importTag(); }} onCancel={() => !importing && setImportOpen(false)}>
        <p className="team-tag-modal-tip">输入 24 小时内有效的单标签分享码。导入后会成为当前账号的独立副本。</p>
        <Input value={importCode} autoFocus placeholder="ST-…" onChange={(event) => setImportCode(event.target.value)} onPressEnter={() => { void importTag(); }} />
      </Modal>
      <Modal title="球队标签分享码" open={Boolean(shareResult)} footer={<Button type="primary" onClick={() => setShareResult(null)}>完成</Button>} onCancel={() => setShareResult(null)}>
        {shareResult && <div className="team-tag-share-result"><p>分享码包含当前标签及球队备注，24 小时内可由多个账号导入。</p><Space.Compact block><Input value={shareResult.code} readOnly /><Button icon={<CopyOutlined />} aria-label="复制分享码" onClick={() => { void navigator.clipboard.writeText(shareResult.code).then(() => message.success("分享码已复制")).catch(() => message.info("请手动复制分享码")); }} /></Space.Compact><small>北京时间 {dayjs(shareResult.expiresAt).format("YYYY-MM-DD HH:mm")} 失效</small></div>}
      </Modal>
    </Card>
  );
}
