"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyPersonalMatchNote,
  mergePersonalMatchNote,
  normalizePersonalMatchNoteId,
  type PersonalMatchNote,
  type PersonalMatchNoteLoadStatus,
  type PersonalMatchNotes,
} from "./match-notes";

export function usePersonalMatchNotes({
  enabled,
  loadNotes,
  saveNote,
}: {
  enabled: boolean;
  loadNotes: (matchIds: string[]) => Promise<PersonalMatchNote[]>;
  saveNote: (matchId: string, note: string, expectedRevision: number) => Promise<PersonalMatchNote>;
}) {
  const [notes, setNotes] = useState<PersonalMatchNotes>({});
  const [statuses, setStatuses] = useState<Record<string, PersonalMatchNoteLoadStatus>>({});
  const notesRef = useRef(notes);
  const statusesRef = useRef(statuses);
  const activeRef = useRef(true);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);
  useEffect(() => {
    statusesRef.current = statuses;
  }, [statuses]);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const load = useCallback(async (rawIds: string[], force = false) => {
    const ids = [...new Set(rawIds.flatMap((value) => {
      const matchId = normalizePersonalMatchNoteId(value);
      return matchId ? [matchId] : [];
    }))];
    if (!enabled || ids.length === 0) return ids.map(emptyPersonalMatchNote);
    const requested = ids.filter((matchId) => {
      const status = statusesRef.current[matchId] ?? "idle";
      return force || (status !== "loading" && status !== "loaded");
    });
    if (requested.length === 0) {
      return ids.map((matchId) => notesRef.current[matchId] ?? emptyPersonalMatchNote(matchId));
    }

    statusesRef.current = { ...statusesRef.current, ...Object.fromEntries(requested.map((matchId) => [matchId, "loading"])) };
    setStatuses(statusesRef.current);
    try {
      const loaded = await loadNotes(requested);
      if (!activeRef.current) return loaded;
      let nextNotes = notesRef.current;
      loaded.forEach((note) => {
        nextNotes = mergePersonalMatchNote(nextNotes, note);
      });
      notesRef.current = nextNotes;
      statusesRef.current = { ...statusesRef.current, ...Object.fromEntries(requested.map((matchId) => [matchId, "loaded"])) };
      setNotes(nextNotes);
      setStatuses(statusesRef.current);
      return ids.map((matchId) => nextNotes[matchId] ?? emptyPersonalMatchNote(matchId));
    } catch (error) {
      if (activeRef.current) {
        statusesRef.current = { ...statusesRef.current, ...Object.fromEntries(requested.map((matchId) => [matchId, "error"])) };
        setStatuses(statusesRef.current);
      }
      throw error;
    }
  }, [enabled, loadNotes]);

  const loadOne = useCallback(async (matchId: string, force = false) => {
    const normalizedId = normalizePersonalMatchNoteId(matchId) ?? matchId;
    const loaded = await load([normalizedId], force);
    return loaded[0] ?? emptyPersonalMatchNote(normalizedId);
  }, [load]);

  const save = useCallback(async (matchId: string, note: string, expectedRevision: number) => {
    const saved = await saveNote(matchId, note, expectedRevision);
    if (!activeRef.current) return saved;
    const nextNotes = mergePersonalMatchNote(notesRef.current, saved);
    notesRef.current = nextNotes;
    statusesRef.current = { ...statusesRef.current, [saved.matchId]: "loaded" };
    setNotes(nextNotes);
    setStatuses(statusesRef.current);
    return saved;
  }, [saveNote]);

  const noteFor = useCallback((matchId: string) => {
    const normalizedId = normalizePersonalMatchNoteId(matchId) ?? matchId;
    return notes[normalizedId] ?? emptyPersonalMatchNote(normalizedId);
  }, [notes]);

  const statusFor = useCallback((matchId: string): PersonalMatchNoteLoadStatus => {
    const normalizedId = normalizePersonalMatchNoteId(matchId) ?? matchId;
    return statuses[normalizedId] ?? "idle";
  }, [statuses]);

  return { load, loadOne, save, noteFor, statusFor };
}
