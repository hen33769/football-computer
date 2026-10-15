"use client";

import { Button, Input, Popover, Space, Tooltip } from "antd";
import { FileTextOutlined, InfoCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { useState } from "react";
import {
  MAX_PERSONAL_MATCH_NOTE_LENGTH,
  type PersonalMatchNote,
  type PersonalMatchNoteLoadStatus,
} from "../match-notes";

export function MatchNotes({
  matchId,
  officialRemark,
  personalNote,
  status,
  canEdit,
  onRequireAccount,
  onLoad,
  onSave,
}: {
  matchId: string;
  officialRemark?: string;
  personalNote: PersonalMatchNote;
  status: PersonalMatchNoteLoadStatus;
  canEdit: boolean;
  onRequireAccount: () => void;
  onLoad: (matchId: string, force?: boolean) => Promise<PersonalMatchNote>;
  onSave: (matchId: string, note: string, expectedRevision: number) => Promise<PersonalMatchNote>;
}) {
  const official = officialRemark?.trim();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editorRevision, setEditorRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadCurrent = async (force = false) => {
    setError("");
    try {
      const loaded = await onLoad(matchId, force);
      if (!dirty || force) {
        setDraft(loaded.note);
        setEditorRevision(loaded.revision);
        setDirty(false);
      }
      return loaded;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "个人备注加载失败");
      throw loadError;
    }
  };

  const changeOpen = (nextOpen: boolean) => {
    if (saving) return;
    if (nextOpen && !canEdit) {
      onRequireAccount();
      return;
    }
    if (nextOpen) {
      setDraft(personalNote.note);
      setEditorRevision(personalNote.revision);
      setDirty(false);
      setError("");
      if (status !== "loaded") void loadCurrent(true).catch(() => undefined);
    }
    setOpen(nextOpen);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(matchId, draft, editorRevision);
      setDirty(false);
      setOpen(false);
    } catch (saveError) {
      const conflict = Number((saveError as Error & { status?: unknown }).status) === 409;
      setError(conflict
        ? "备注已在其他位置更新，请先加载最新内容"
        : saveError instanceof Error ? saveError.message : "个人备注保存失败");
    } finally {
      setSaving(false);
    }
  };

  const tooltip = status === "loading"
    ? "正在加载个人备注"
    : status === "error"
      ? "个人备注加载失败，点击重试"
      : personalNote.note || "暂无个人备注，点击编辑";
  const editor = (
    <div className="personal-match-note-editor">
      <div className="personal-match-note-editor-title"><b>个人备注</b><span>仅当前账号可见</span></div>
      <Input.TextArea
        value={draft}
        disabled={saving || status === "loading"}
        maxLength={MAX_PERSONAL_MATCH_NOTE_LENGTH}
        autoSize={{ minRows: 3, maxRows: 8 }}
        showCount
        placeholder="输入这场比赛的个人备注"
        onChange={(event) => {
          setDraft(event.target.value);
          setDirty(true);
          setError("");
        }}
      />
      {error && <div className="personal-match-note-error" role="alert">{error}</div>}
      <div className="personal-match-note-editor-actions">
        {error.includes("其他位置更新") && (
          <Button size="small" icon={<ReloadOutlined />} disabled={saving} onClick={() => { void loadCurrent(true).catch(() => undefined); }}>加载最新</Button>
        )}
        <Space size="small">
          <Button size="small" disabled={saving} onClick={() => changeOpen(false)}>取消</Button>
          <Button
            size="small"
            type="primary"
            loading={saving}
            disabled={status !== "loaded" || !dirty || draft.trim() === personalNote.note}
            onClick={() => { void save(); }}
          >保存</Button>
        </Space>
      </div>
    </div>
  );

  return (
    <span className="match-note-icons">
      {official && (
        <Tooltip title={<span className="match-note-tooltip-text">{official}</span>} trigger={["hover", "focus", "click"]}>
          <button type="button" className="match-note-button official" aria-label={`官方备注：${official}`}>
            <InfoCircleOutlined aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      <Popover content={editor} trigger="click" open={canEdit && open} onOpenChange={changeOpen} placement="bottom">
        <Tooltip open={open ? false : undefined} title={<span className="match-note-tooltip-text">{tooltip}</span>} trigger={["hover", "focus"]}>
          <button
            type="button"
            className={`match-note-button personal ${personalNote.note ? "has-note" : "empty"}`}
            aria-label={personalNote.note ? `个人备注：${personalNote.note}` : "暂无个人备注，点击编辑"}
          >
            <FileTextOutlined aria-hidden="true" />
          </button>
        </Tooltip>
      </Popover>
    </span>
  );
}
