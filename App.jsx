import React, { useState, useEffect, useCallback } from "react";
import {
  Plus, Trash2, Pencil, ChevronDown, ChevronRight, Search, Download,
  Flag, Link2, Building2, FileText, Layers, ClipboardList, Loader2, LogOut,
} from "lucide-react";
import Papa from "papaparse";
import { supabase } from "./supabaseClient";

/* ------------------------------------------------------------------
   Schema — one config object drives forms, tables, and validation.
   Keys match the Postgres column names exactly (see schema.sql).
------------------------------------------------------------------- */

const ENTITY_ORDER = ["firms", "assignments", "work_orders", "documents", "document_links", "field_values", "flags"];

const ICONS = {
  firms: Building2, assignments: Layers, work_orders: ClipboardList,
  documents: FileText, document_links: Link2, field_values: Search, flags: Flag,
};

const SOURCE_META = {
  Direct: { color: "#2F6F62" }, Invoice: { color: "#C97D2A" },
  Derived: { color: "#7A5FB0" }, BOQ: { color: "#B94A48" },
};

const CONFIG = {
  firms: {
    label: "Firms", singular: "Firm", primary: "name",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "notes", label: "Notes", type: "text" },
    ],
  },
  assignments: {
    label: "Assignments", singular: "Assignment", primary: "event_name",
    fields: [
      { key: "event_name", label: "Event name", type: "text", required: true },
      { key: "firm_id", label: "Firm", type: "link", ref: "firms", required: true },
      { key: "project_category", label: "Project category", type: "select", options: ["Examination", "Elections"] },
      { key: "client_authority", label: "Client / Authority", type: "text" },
      { key: "state", label: "State", type: "text" },
    ],
  },
  work_orders: {
    label: "Work Orders", singular: "Work Order", primary: "wo_number",
    fields: [
      { key: "wo_number", label: "WO number", type: "text", required: true },
      { key: "assignment_id", label: "Assignment", type: "link", ref: "assignments", required: true },
      { key: "status", label: "Status", type: "select", options: ["Awarded", "Ongoing", "Completed"] },
      { key: "financial_year", label: "Financial year", type: "text" },
      { key: "scope", label: "Scope", type: "text" },
      { key: "candidates_count", label: "Candidates count", type: "number" },
      { key: "camera_count", label: "Camera count", type: "number" },
      { key: "centres_or_booths", label: "Centres / booths", type: "number" },
      { key: "wo_value", label: "WO value (₹)", type: "number" },
      { key: "duration_deployment", label: "Duration of deployment", type: "text" },
    ],
  },
  documents: {
    label: "Documents", singular: "Document", primary: "title",
    fields: [
      { key: "title", label: "Doc title / Memo no.", type: "text", required: true },
      { key: "firm_id", label: "Firm", type: "link", ref: "firms", required: true },
      { key: "doc_type", label: "Doc type", type: "select", options: ["WO Letter", "WCC", "Invoice", "Rate Approval", "Declaration Letter", "Correspondence"] },
    ],
  },
  document_links: {
    label: "Document Links", singular: "Document Link", primary: null,
    fields: [
      { key: "document_id", label: "Document", type: "link", ref: "documents", required: true },
      { key: "work_order_id", label: "Work Order", type: "link", ref: "work_orders", required: true },
      { key: "role", label: "Role", type: "select", options: ["Originating", "Enriching"] },
      { key: "fields_enriched", label: "Fields enriched", type: "multiselect", options: ["candidates_count", "camera_count", "centres_or_booths", "wo_value"] },
    ],
  },
  field_values: {
    label: "Field Values", singular: "Field Value", primary: null,
    fields: [
      { key: "work_order_id", label: "Work Order", type: "link", ref: "work_orders", required: true },
      { key: "field_name", label: "Field", type: "select", options: ["candidates_count", "camera_count", "centres_or_booths", "wo_value"] },
      { key: "value", label: "Value", type: "text", required: true },
      { key: "source_type", label: "Source type", type: "select", options: ["Direct", "Invoice", "Derived", "BOQ"] },
      { key: "source_document_id", label: "Source document", type: "link", ref: "documents" },
    ],
  },
  flags: {
    label: "Flags", singular: "Flag", primary: "description",
    fields: [
      { key: "description", label: "Description", type: "text", required: true },
      { key: "type", label: "Type", type: "select", options: ["Correspondence only", "Duplicate WO", "Inconsistent field", "Non-derivable"] },
      { key: "work_order_id", label: "Work Order", type: "link", ref: "work_orders" },
      { key: "document_id", label: "Document", type: "link", ref: "documents" },
      { key: "resolved", label: "Resolved", type: "checkbox" },
    ],
  },
};

const emptyLedger = () => ({ firms: [], assignments: [], work_orders: [], documents: [], document_links: [], field_values: [], flags: [] });

/* ------------------------------------------------------------------
   Helpers (pure — same logic as the local prototype)
------------------------------------------------------------------- */

function labelFor(entityKey, id, ledger) {
  if (!id) return "—";
  const cfg = CONFIG[entityKey];
  const row = (ledger[entityKey] || []).find((r) => r.id === id);
  if (!row) return "(deleted)";
  if (cfg.primary) return row[cfg.primary] || "(untitled)";
  if (entityKey === "document_links") return `${labelFor("documents", row.document_id, ledger)} → ${labelFor("work_orders", row.work_order_id, ledger)}`;
  if (entityKey === "field_values") return `${row.field_name || "field"}: ${row.value ?? "-"} (${labelFor("work_orders", row.work_order_id, ledger)})`;
  return row.id;
}

function getRelated(entityKey, id, ledger) {
  switch (entityKey) {
    case "firms":
      return { Assignments: ledger.assignments.filter((a) => a.firm_id === id), Documents: ledger.documents.filter((d) => d.firm_id === id) };
    case "assignments":
      return { "Work Orders": ledger.work_orders.filter((w) => w.assignment_id === id) };
    case "work_orders":
      return {
        Documents: ledger.document_links.filter((l) => l.work_order_id === id).map((l) => ({ id: l.id, label: labelFor("documents", l.document_id, ledger), sub: l.role })),
        "Field values": ledger.field_values.filter((f) => f.work_order_id === id),
        Flags: ledger.flags.filter((f) => f.work_order_id === id),
      };
    case "documents":
      return {
        "Work Orders": ledger.document_links.filter((l) => l.document_id === id).map((l) => ({ id: l.id, label: labelFor("work_orders", l.work_order_id, ledger), sub: l.role })),
        Flags: ledger.flags.filter((f) => f.document_id === id),
      };
    default:
      return {};
  }
}

/* ------------------------------------------------------------------
   Small atoms
------------------------------------------------------------------- */

function SourceDot({ source }) {
  const meta = SOURCE_META[source] || SOURCE_META.Direct;
  return <span title={source} style={{ background: meta.color }} className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle shrink-0" />;
}

function Field({ field, value, onChange, ledger }) {
  const common = { style: { borderColor: "#DFE1E8" }, className: "w-full px-2.5 py-1.5 rounded border text-sm outline-none" };
  if (field.type === "link") {
    const options = ledger[field.ref] || [];
    return (
      <select value={value || ""} onChange={(e) => onChange(e.target.value || null)} {...common}>
        <option value="">— none —</option>
        {options.map((o) => <option key={o.id} value={o.id}>{labelFor(field.ref, o.id, ledger)}</option>)}
      </select>
    );
  }
  if (field.type === "select") {
    return (
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} {...common}>
        <option value="">— select —</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.type === "multiselect") {
    const arr = Array.isArray(value) ? value : [];
    const toggle = (opt) => onChange(arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt]);
    return (
      <div className="flex flex-wrap gap-1.5">
        {field.options.map((o) => (
          <button type="button" key={o} onClick={() => toggle(o)} className="text-xs px-2 py-1 rounded border"
            style={{ borderColor: arr.includes(o) ? "#2F6F62" : "#DFE1E8", background: arr.includes(o) ? "#E1F5EE" : "white", color: arr.includes(o) ? "#0F6E56" : "#5C6B85" }}>
            {o}
          </button>
        ))}
      </div>
    );
  }
  if (field.type === "checkbox") return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4" />;
  if (field.type === "number") return <input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} {...common} />;
  return <input type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...common} />;
}

function RecordForm({ entityKey, initial, onSave, onCancel, ledger, saving }) {
  const cfg = CONFIG[entityKey];
  const [data, setData] = useState(initial || {});
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const canSave = cfg.fields.filter((f) => f.required).every((f) => data[f.key]);
  return (
    <div className="rounded-lg border p-4 mb-3" style={{ borderColor: "#DFE1E8", background: "#F7F7F5" }}>
      <div className="grid sm:grid-cols-2 gap-3">
        {cfg.fields.map((f) => (
          <div key={f.key} className={f.type === "multiselect" ? "sm:col-span-2" : ""}>
            <label className="block text-xs font-medium mb-1" style={{ color: "#5C6B85" }}>{f.label}{f.required ? " *" : ""}</label>
            <Field field={f} value={data[f.key]} onChange={(v) => set(f.key, v)} ledger={ledger} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <button disabled={!canSave || saving} onClick={() => onSave(data)} className="text-sm px-3 py-1.5 rounded font-medium disabled:opacity-50 inline-flex items-center gap-1.5" style={{ background: "#2F6F62", color: "white" }}>
          {saving && <Loader2 size={13} className="animate-spin" />} Save
        </button>
        <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded border" style={{ borderColor: "#DFE1E8" }}>Cancel</button>
      </div>
    </div>
  );
}

function RelatedPanel({ related }) {
  const groups = Object.entries(related).filter(([, arr]) => arr && arr.length);
  if (!groups.length) return <p className="text-xs px-3 pb-3" style={{ color: "#5C6B85" }}>No linked records yet.</p>;
  return (
    <div className="px-3 pb-3 space-y-2">
      {groups.map(([groupLabel, arr]) => (
        <div key={groupLabel}>
          <p className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: "#5C6B85" }}>{groupLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {arr.map((r) => (
              <span key={r.id} className="text-xs px-2 py-1 rounded" style={{ background: "#EEF0F4", color: "#1A2238" }}>
                {r.label || r.wo_number || r.event_name || r.description || r.field_name || r.title || "record"}
                {r.sub ? <span style={{ color: "#5C6B85" }}> · {r.sub}</span> : null}
                {r.resolved === false ? <span style={{ color: "#B94A48" }}> · open</span> : null}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------
   Auth gate
------------------------------------------------------------------- */

function LoginScreen() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setNotice("Account created. If email confirmation is on, check your inbox before signing in.");
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#F7F7F5" }}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border p-6" style={{ borderColor: "#DFE1E8", background: "white" }}>
        <h1 className="text-lg font-semibold mb-1" style={{ color: "#1A2238" }}>Credential Ledger</h1>
        <p className="text-sm mb-4" style={{ color: "#5C6B85" }}>{mode === "signin" ? "Sign in to your team workspace" : "Create a teammate account"}</p>
        <div className="space-y-3">
          <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 rounded border text-sm outline-none" style={{ borderColor: "#DFE1E8" }} />
          <input type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 rounded border text-sm outline-none" style={{ borderColor: "#DFE1E8" }} />
        </div>
        {error && <p className="text-xs mt-2" style={{ color: "#B94A48" }}>{error}</p>}
        {notice && <p className="text-xs mt-2" style={{ color: "#0F6E56" }}>{notice}</p>}
        <button disabled={busy} type="submit" className="w-full mt-4 py-2 rounded text-sm font-medium disabled:opacity-60" style={{ background: "#2F6F62", color: "white" }}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
        <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="w-full mt-2 text-xs" style={{ color: "#5C6B85" }}>
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------
   Main app
------------------------------------------------------------------- */

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = unknown yet
  const [ledger, setLedger] = useState(emptyLedger());
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("work_orders");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const fetchAll = useCallback(async () => {
    setErrorMsg("");
    const results = await Promise.all(ENTITY_ORDER.map((t) => supabase.from(t).select("*").order("created_at")));
    const bad = results.find((r) => r.error);
    if (bad) { setErrorMsg(bad.error.message); return; }
    const next = {};
    ENTITY_ORDER.forEach((t, i) => { next[t] = results[i].data || []; });
    setLedger(next);
    setLoaded(true);
  }, []);

  useEffect(() => { if (session) fetchAll(); }, [session, fetchAll]);

  async function addRecord(entityKey, record) {
    setSaving(true);
    const { error } = await supabase.from(entityKey).insert(record);
    setSaving(false);
    if (error) { setErrorMsg(error.message); return; }
    setAdding(false);
    fetchAll();
  }
  async function updateRecord(entityKey, id, patch) {
    setSaving(true);
    const { error } = await supabase.from(entityKey).update(patch).eq("id", id);
    setSaving(false);
    if (error) { setErrorMsg(error.message); return; }
    setEditingId(null);
    fetchAll();
  }
  async function deleteRecord(entityKey, id) {
    const { error } = await supabase.from(entityKey).delete().eq("id", id);
    if (error) { setErrorMsg(error.message); return; }
    fetchAll();
  }

  function masterRows() {
    return ledger.work_orders.map((wo) => {
      const assignment = ledger.assignments.find((a) => a.id === wo.assignment_id);
      const firm = assignment ? ledger.firms.find((f) => f.id === assignment.firm_id) : null;
      const fv = (field) => ledger.field_values.find((f) => f.work_order_id === wo.id && f.field_name === field);
      const val = (field) => { const f = fv(field); return f ? f.value : (wo[field] ?? "-"); };
      const src = (field) => { const f = fv(field); return f ? f.source_type : "Direct"; };
      return {
        id: wo.id, firm: firm?.name || "—", event: assignment?.event_name || "—",
        wo_number: wo.wo_number, status: wo.status || "—", category: assignment?.project_category || "—",
        candidates: val("candidates_count"), candidates_source: src("candidates_count"),
        cameras: val("camera_count"), cameras_source: src("camera_count"),
        wo_value: val("wo_value"), wo_value_source: src("wo_value"),
        doc_count: ledger.document_links.filter((l) => l.work_order_id === wo.id).length,
        open_flags: ledger.flags.filter((f) => f.work_order_id === wo.id && !f.resolved).length,
      };
    });
  }

  function exportMasterCSV() {
    const rows = masterRows();
    const header = ["Firm", "Event", "WO Number", "Status", "Category", "Candidates", "Candidates Source", "Cameras", "Cameras Source", "WO Value", "WO Value Source", "Linked Docs", "Open Flags"];
    const data = rows.map((r) => [r.firm, r.event, r.wo_number, r.status, r.category, r.candidates, r.candidates_source, r.cameras, r.cameras_source, r.wo_value, r.wo_value_source, r.doc_count, r.open_flags]);
    const csv = Papa.unparse([header, ...data]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "master-ledger.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  if (session === undefined) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: "#F7F7F5", color: "#5C6B85" }}><Loader2 className="animate-spin" size={18} /></div>;
  }
  if (!session) return <LoginScreen />;

  const cfg = tab !== "master" ? CONFIG[tab] : null;
  const rows = tab !== "master" ? ledger[tab] || [] : [];
  const filteredRows = rows.filter((r) => !search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase()));
  const editingRow = editingId ? rows.find((r) => r.id === editingId) : null;

  return (
    <div className="w-full min-h-screen flex" style={{ background: "#F7F7F5", color: "#1A2238", fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui" }}>
      <div className="w-56 shrink-0 border-r p-3 flex flex-col" style={{ borderColor: "#DFE1E8", background: "#1A2238" }}>
        <p className="text-sm font-bold px-2 py-2" style={{ color: "#F7F7F5" }}>Credential Ledger</p>
        <p className="text-xs px-2 pb-2 truncate" style={{ color: "#9AA3BD" }}>{session.user.email}</p>
        <nav className="space-y-0.5 mt-1 flex-1">
          {ENTITY_ORDER.map((key) => {
            const Icon = ICONS[key];
            return (
              <button key={key} onClick={() => { setTab(key); setAdding(false); setEditingId(null); setSearch(""); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm"
                style={{ background: tab === key ? "#2F6F62" : "transparent", color: tab === key ? "white" : "#9AA3BD" }}>
                <Icon size={14} /> {CONFIG[key].label}
                <span className="ml-auto text-xs opacity-70">{ledger[key]?.length || 0}</span>
              </button>
            );
          })}
          <button onClick={() => { setTab("master"); setAdding(false); setEditingId(null); }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm mt-2 border-t pt-2.5"
            style={{ background: tab === "master" ? "#2F6F62" : "transparent", color: tab === "master" ? "white" : "#9AA3BD", borderColor: "#2C3654" }}>
            <ClipboardList size={14} /> Master Ledger
          </button>
        </nav>
        <button onClick={() => supabase.auth.signOut()} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm" style={{ color: "#9AA3BD" }}>
          <LogOut size={14} /> Sign out
        </button>
      </div>

      <div className="flex-1 p-6 max-w-5xl">
        {errorMsg && <div className="mb-3 text-sm rounded px-3 py-2" style={{ background: "#FBEAEA", color: "#B94A48" }}>{errorMsg}</div>}

        {!loaded ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "#5C6B85" }}><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : tab === "master" ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Master Ledger</h2>
              <button onClick={exportMasterCSV} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded font-medium" style={{ background: "#1A2238", color: "white" }}>
                <Download size={14} /> Export CSV
              </button>
            </div>
            <div className="rounded-lg border overflow-x-auto" style={{ borderColor: "#DFE1E8", background: "white" }}>
              <table className="text-xs w-full">
                <thead><tr style={{ background: "#F7F7F5" }}>
                  {["Firm", "Event", "WO Number", "Status", "Category", "Candidates", "Cameras", "WO Value", "Docs", "Open Flags"].map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap" style={{ color: "#5C6B85" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {masterRows().map((r) => (
                    <tr key={r.id} className="border-t" style={{ borderColor: "#EEF0F4" }}>
                      <td className="px-3 py-2 whitespace-nowrap">{r.firm}</td>
                      <td className="px-3 py-2 max-w-[180px] truncate">{r.event}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.wo_number}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.status}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.category}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><SourceDot source={r.candidates_source} />{r.candidates}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><SourceDot source={r.cameras_source} />{r.cameras}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><SourceDot source={r.wo_value_source} />{r.wo_value}</td>
                      <td className="px-3 py-2">{r.doc_count}</td>
                      <td className="px-3 py-2">{r.open_flags > 0 ? <span style={{ color: "#B94A48" }}>{r.open_flags}</span> : "0"}</td>
                    </tr>
                  ))}
                  {masterRows().length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center" style={{ color: "#5C6B85" }}>No Work Orders yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <h2 className="text-lg font-semibold">{cfg.label}</h2>
              <div className="flex gap-2 items-center">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "#5C6B85" }} />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-7 pr-2 py-1.5 rounded border text-sm outline-none" style={{ borderColor: "#DFE1E8" }} />
                </div>
                <button onClick={() => { setAdding((v) => !v); setEditingId(null); }} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded font-medium" style={{ background: "#2F6F62", color: "white" }}>
                  <Plus size={14} /> Add {cfg.singular}
                </button>
              </div>
            </div>

            {adding && <RecordForm entityKey={tab} onSave={(d) => addRecord(tab, d)} onCancel={() => setAdding(false)} ledger={ledger} saving={saving} />}

            {filteredRows.length === 0 ? (
              <div className="rounded-lg border p-8 text-center text-sm" style={{ borderColor: "#DFE1E8", background: "white", color: "#5C6B85" }}>
                {rows.length === 0 ? `No ${cfg.label.toLowerCase()} yet.` : "No matches."}
              </div>
            ) : (
              <div className="rounded-lg border divide-y" style={{ borderColor: "#DFE1E8", background: "white" }}>
                {filteredRows.map((r) => (
                  <div key={r.id}>
                    {editingId === r.id ? (
                      <div className="p-3">
                        <RecordForm entityKey={tab} initial={r} onSave={(d) => updateRecord(tab, r.id, d)} onCancel={() => setEditingId(null)} ledger={ledger} saving={saving} />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-[#F7F7F5]" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                          {expandedId === r.id ? <ChevronDown size={14} style={{ color: "#5C6B85" }} /> : <ChevronRight size={14} style={{ color: "#5C6B85" }} />}
                          <div className="flex-1 grid sm:grid-cols-3 gap-x-4 gap-y-0.5 text-sm min-w-0">
                            {cfg.fields.slice(0, 4).map((f) => (
                              <span key={f.key} className="truncate">
                                <span style={{ color: "#5C6B85" }} className="text-xs">{f.label}: </span>
                                {f.type === "link" ? labelFor(f.ref, r[f.key], ledger)
                                  : f.type === "checkbox" ? (r[f.key] ? "Yes" : "No")
                                  : f.type === "multiselect" ? (r[f.key] || []).join(", ") || "—"
                                  : (r[f.key] ?? "—")}
                              </span>
                            ))}
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); setEditingId(r.id); setAdding(false); }}><Pencil size={13} style={{ color: "#5C6B85" }} /></button>
                          <button onClick={(e) => { e.stopPropagation(); deleteRecord(tab, r.id); }}><Trash2 size={13} style={{ color: "#B94A48" }} /></button>
                        </div>
                        {expandedId === r.id && <div style={{ background: "#F7F7F5" }}><RelatedPanel related={getRelated(tab, r.id, ledger)} /></div>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
