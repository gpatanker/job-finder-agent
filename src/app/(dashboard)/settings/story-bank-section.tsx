"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { StoryBankEntry } from "@/lib/db/schema";
import { Modal } from "@/components/ui/modal";

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50";

type StoryFormValues = { slug: string; title: string; tags: string; content: string };

function StoryForm({
  initial,
  isNew,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: StoryFormValues;
  isNew: boolean;
  pending: boolean;
  onSubmit: (values: StoryFormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-testid="story-form">
      <div className="space-y-1">
        <label className="text-sm font-medium">Slug</label>
        <input
          className={inputClass}
          value={values.slug}
          disabled={!isNew}
          onChange={(e) => setValues((v) => ({ ...v, slug: e.target.value }))}
          data-testid="story-form-slug"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Title</label>
        <input
          className={inputClass}
          value={values.title}
          onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
          data-testid="story-form-title"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Tags (comma-separated)</label>
        <input
          className={inputClass}
          value={values.tags}
          onChange={(e) => setValues((v) => ({ ...v, tags: e.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Content</label>
        <textarea
          className={`${inputClass} min-h-40`}
          value={values.content}
          onChange={(e) => setValues((v) => ({ ...v, content: e.target.value }))}
          data-testid="story-form-content"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20">
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          data-testid="story-form-submit"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}

export function StoryBankSection({ stories: initialStories }: { stories: StoryBankEntry[] }) {
  const [stories, setStories] = useState(initialStories);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<StoryBankEntry | null>(null);
  const [pending, setPending] = useState(false);

  async function handleCreate(values: StoryFormValues) {
    setPending(true);
    try {
      const res = await fetch("/api/settings/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: values.slug,
          title: values.title,
          tags: values.tags.split(",").map((t) => t.trim()).filter(Boolean),
          content: values.content,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to add story");
      setStories((s) => [...s, body.story].sort((a, b) => a.title.localeCompare(b.title)));
      toast.success("Story added");
      setShowAdd(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add story");
    } finally {
      setPending(false);
    }
  }

  async function handleEdit(values: StoryFormValues) {
    if (!editing) return;
    setPending(true);
    try {
      const res = await fetch(`/api/settings/stories/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          tags: values.tags.split(",").map((t) => t.trim()).filter(Boolean),
          content: values.content,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update story");
      setStories((s) => s.map((story) => (story.id === body.story.id ? body.story : story)));
      toast.success("Story updated");
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update story");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(story: StoryBankEntry) {
    if (!confirm(`Delete story "${story.title}"?`)) return;
    try {
      const res = await fetch(`/api/settings/stories/${story.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete story");
      setStories((s) => s.filter((x) => x.id !== story.id));
      toast.success("Story deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete story");
    }
  }

  return (
    <div className="space-y-3" data-testid="story-bank-section">
      <div className="flex items-center justify-between">
        <p className="text-sm text-black/60 dark:text-white/60">
          {stories.length} stories grounding generated answers
        </p>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          data-testid="add-story-button"
        >
          Add story
        </button>
      </div>

      <div className="space-y-2">
        {stories.map((story) => (
          <div key={story.id} className="rounded-lg border border-black/10 p-3 dark:border-white/15" data-testid={`story-${story.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{story.title}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {story.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => setEditing(story)} className="text-xs hover:underline" data-testid={`edit-story-${story.id}`}>
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(story)}
                  className="text-xs text-black/50 hover:underline dark:text-white/50"
                  data-testid={`delete-story-${story.id}`}
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-black/60 dark:text-white/60">
              {story.content}
            </p>
          </div>
        ))}
      </div>

      {showAdd && (
        <Modal title="Add story" onClose={() => setShowAdd(false)}>
          <StoryForm
            initial={{ slug: "", title: "", tags: "", content: "" }}
            isNew
            pending={pending}
            onSubmit={handleCreate}
            onCancel={() => setShowAdd(false)}
          />
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit: ${editing.title}`} onClose={() => setEditing(null)}>
          <StoryForm
            initial={{
              slug: editing.slug,
              title: editing.title,
              tags: editing.tags.join(", "),
              content: editing.content,
            }}
            isNew={false}
            pending={pending}
            onSubmit={handleEdit}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}
