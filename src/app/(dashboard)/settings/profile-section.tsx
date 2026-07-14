"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { CandidateProfile, EducationEntry } from "@/lib/db/schema";

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50";

function toCsv(items: string[]) {
  return items.join(", ");
}
function fromCsv(value: string) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ProfileSection({ profile }: { profile: CandidateProfile | null }) {
  const [name, setName] = useState(profile?.name ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [linkedin, setLinkedin] = useState(profile?.linkedin ?? "");
  const [location, setLocation] = useState(profile?.location ?? "");
  const [currentCompany, setCurrentCompany] = useState(
    profile?.currentCompany ?? ""
  );
  const [functionTags, setFunctionTags] = useState(
    toCsv(profile?.functionTags ?? [])
  );
  const [preferredIndustries, setPreferredIndustries] = useState(
    toCsv(profile?.preferredIndustries ?? [])
  );
  const [workAuthorized, setWorkAuthorized] = useState(
    profile?.workAuthorized ?? true
  );
  const [requiresSponsorship, setRequiresSponsorship] = useState(
    profile?.requiresSponsorship ?? false
  );
  const [genderIdentity, setGenderIdentity] = useState(profile?.genderIdentity ?? "");
  const [raceEthnicity, setRaceEthnicity] = useState(profile?.raceEthnicity ?? "");
  const [sexualOrientation, setSexualOrientation] = useState(
    profile?.sexualOrientation ?? ""
  );
  const [veteranStatus, setVeteranStatus] = useState(profile?.veteranStatus ?? "");
  const [education, setEducation] = useState<EducationEntry[]>(
    profile?.education?.length ? profile.education : [{ school: "", degree: "" }]
  );
  const [roleFamilies, setRoleFamilies] = useState(
    toCsv(profile?.searchCriteria?.roleFamilies ?? [])
  );
  const [locations, setLocations] = useState(
    toCsv(profile?.searchCriteria?.locations ?? [])
  );
  const [industries, setIndustries] = useState(
    toCsv(profile?.searchCriteria?.industries ?? [])
  );
  const [salaryFloor, setSalaryFloor] = useState(
    profile?.searchCriteria?.salaryFloor?.toString() ?? ""
  );
  const [saving, setSaving] = useState(false);

  function updateEducation(index: number, field: keyof EducationEntry, value: string) {
    setEducation((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          linkedin,
          location,
          currentCompany,
          functionTags: fromCsv(functionTags),
          preferredIndustries: fromCsv(preferredIndustries),
          workAuthorized,
          requiresSponsorship,
          genderIdentity: genderIdentity || undefined,
          raceEthnicity: raceEthnicity || undefined,
          sexualOrientation: sexualOrientation || undefined,
          veteranStatus: veteranStatus || undefined,
          education: education.filter((e) => e.school || e.degree),
          searchCriteria: {
            roleFamilies: fromCsv(roleFamilies),
            locations: fromCsv(locations),
            industries: fromCsv(industries),
            salaryFloor: salaryFloor ? Number(salaryFloor) : undefined,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save profile");
      }
      toast.success("Profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="profile-form">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Name</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} data-testid="profile-name" />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Email</label>
          <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Phone</label>
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">LinkedIn</label>
          <input className={inputClass} value={linkedin} onChange={(e) => setLinkedin(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Location</label>
          <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Current company</label>
          <input className={inputClass} value={currentCompany} onChange={(e) => setCurrentCompany(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Function tags (comma-separated)</label>
        <input className={inputClass} value={functionTags} onChange={(e) => setFunctionTags(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Preferred industries (comma-separated)</label>
        <input className={inputClass} value={preferredIndustries} onChange={(e) => setPreferredIndustries(e.target.value)} />
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={workAuthorized}
            onChange={(e) => setWorkAuthorized(e.target.checked)}
          />
          Legally authorized to work in the US
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requiresSponsorship}
            onChange={(e) => setRequiresSponsorship(e.target.checked)}
          />
          Requires visa sponsorship now/future
        </label>
      </div>

      <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
        <p className="mb-1 text-sm font-medium">Optional self-identification</p>
        <p className="mb-2 text-xs text-black/60 dark:text-white/60">
          Used only to answer EEO/demographic questions during application review — never
          scraped or guessed. Leave any field blank to have the Apply Run Brief tell the
          automation to select &ldquo;decline to answer&rdquo; for it instead.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-black/60 dark:text-white/60">Gender identity</label>
            <input
              className={inputClass}
              value={genderIdentity}
              onChange={(e) => setGenderIdentity(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-black/60 dark:text-white/60">Race / ethnicity</label>
            <input
              className={inputClass}
              value={raceEthnicity}
              onChange={(e) => setRaceEthnicity(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-black/60 dark:text-white/60">Sexual orientation</label>
            <input
              className={inputClass}
              value={sexualOrientation}
              onChange={(e) => setSexualOrientation(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-black/60 dark:text-white/60">Veteran status</label>
            <input
              className={inputClass}
              value={veteranStatus}
              onChange={(e) => setVeteranStatus(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Education</label>
          <button
            type="button"
            className="text-xs hover:underline"
            onClick={() => setEducation((rows) => [...rows, { school: "", degree: "" }])}
          >
            + Add
          </button>
        </div>
        {education.map((row, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={inputClass}
              placeholder="School"
              value={row.school}
              onChange={(e) => updateEducation(i, "school", e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Degree"
              value={row.degree}
              onChange={(e) => updateEducation(i, "degree", e.target.value)}
            />
            <button
              type="button"
              onClick={() => setEducation((rows) => rows.filter((_, idx) => idx !== i))}
              className="text-xs text-black/50 hover:underline dark:text-white/50"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
        <p className="mb-2 text-sm font-medium">Target search criteria</p>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-black/60 dark:text-white/60">Role families (comma-separated)</label>
            <input className={inputClass} value={roleFamilies} onChange={(e) => setRoleFamilies(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-black/60 dark:text-white/60">Locations (comma-separated)</label>
            <input className={inputClass} value={locations} onChange={(e) => setLocations(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-black/60 dark:text-white/60">Industries (comma-separated)</label>
            <input className={inputClass} value={industries} onChange={(e) => setIndustries(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-black/60 dark:text-white/60">Salary floor</label>
            <input type="number" className={inputClass} value={salaryFloor} onChange={(e) => setSalaryFloor(e.target.value)} />
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        data-testid="profile-save"
      >
        {saving ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}
