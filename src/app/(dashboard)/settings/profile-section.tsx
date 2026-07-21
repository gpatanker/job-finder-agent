"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import type { CandidateProfile, EducationEntry } from "@/lib/db/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

function toCsv(items: string[]) {
  return items.join(", ");
}
function fromCsv(value: string) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function Field({
  label,
  children,
  htmlFor,
  className,
}: {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
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
  const [disabilityStatus, setDisabilityStatus] = useState(
    profile?.disabilityStatus ?? ""
  );
  const [zipCode, setZipCode] = useState(profile?.zipCode ?? "");
  const [highestEducationLevel, setHighestEducationLevel] = useState(
    profile?.highestEducationLevel ?? ""
  );
  const [totalYearsExperience, setTotalYearsExperience] = useState(
    profile?.totalYearsExperience?.toString() ?? ""
  );
  const [requiresRelocationAssistance, setRequiresRelocationAssistance] = useState(
    profile?.requiresRelocationAssistance ?? false
  );
  const [howHeardDefault, setHowHeardDefault] = useState(profile?.howHeardDefault ?? "");
  const [aiPolicyAgreement, setAiPolicyAgreement] = useState(
    profile?.aiPolicyAgreement ?? ""
  );
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
          disabilityStatus: disabilityStatus || undefined,
          zipCode: zipCode || undefined,
          highestEducationLevel: highestEducationLevel || undefined,
          totalYearsExperience: totalYearsExperience ? Number(totalYearsExperience) : undefined,
          requiresRelocationAssistance,
          howHeardDefault: howHeardDefault || undefined,
          aiPolicyAgreement: aiPolicyAgreement || undefined,
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
    <form onSubmit={handleSubmit} className="mt-4 space-y-4" data-testid="profile-form">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="profile-name" />
        </Field>
        <Field label="Email">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="LinkedIn">
          <Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} />
        </Field>
        <Field label="Location">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label="Current company">
          <Input value={currentCompany} onChange={(e) => setCurrentCompany(e.target.value)} />
        </Field>
      </div>

      <Field label="Function tags (comma-separated)">
        <Input value={functionTags} onChange={(e) => setFunctionTags(e.target.value)} />
      </Field>
      <Field label="Preferred industries (comma-separated)">
        <Input value={preferredIndustries} onChange={(e) => setPreferredIndustries(e.target.value)} />
      </Field>

      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <Checkbox
            id="work-authorized"
            checked={workAuthorized}
            onCheckedChange={(checked) => setWorkAuthorized(checked === true)}
          />
          <Label htmlFor="work-authorized" className="font-normal">
            Legally authorized to work in the US
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="requires-sponsorship"
            checked={requiresSponsorship}
            onCheckedChange={(checked) => setRequiresSponsorship(checked === true)}
          />
          <Label htmlFor="requires-sponsorship" className="font-normal">
            Requires visa sponsorship now/future
          </Label>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Optional self-identification</CardTitle>
          <CardDescription>
            Used only to answer EEO/demographic questions during application review — never
            scraped or guessed. Leave any field blank to have the Apply Run Brief tell the
            automation to select &ldquo;decline to answer&rdquo; for it instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Field label="Gender identity">
            <Input value={genderIdentity} onChange={(e) => setGenderIdentity(e.target.value)} />
          </Field>
          <Field label="Race / ethnicity">
            <Input value={raceEthnicity} onChange={(e) => setRaceEthnicity(e.target.value)} />
          </Field>
          <Field label="Sexual orientation">
            <Input value={sexualOrientation} onChange={(e) => setSexualOrientation(e.target.value)} />
          </Field>
          <Field label="Veteran status">
            <Input value={veteranStatus} onChange={(e) => setVeteranStatus(e.target.value)} />
          </Field>
          <Field label="Disability status">
            <Input value={disabilityStatus} onChange={(e) => setDisabilityStatus(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Common application fields</CardTitle>
          <CardDescription>
            Recurring structured questions (dropdowns/short fields, not essay prompts) across ATS
            platforms — filling these in lets the Apply Run Brief answer them directly instead of
            the Computer pausing to ask on every application.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Zip code">
              <Input value={zipCode} onChange={(e) => setZipCode(e.target.value)} />
            </Field>
            <Field label="Highest education level">
              <Input
                placeholder="e.g. Master's Degree"
                value={highestEducationLevel}
                onChange={(e) => setHighestEducationLevel(e.target.value)}
              />
            </Field>
            <Field label='"How did you hear about this opportunity?" default'>
              <Input value={howHeardDefault} onChange={(e) => setHowHeardDefault(e.target.value)} />
            </Field>
            <Field label="AI interview-policy agreement default">
              <Input
                placeholder="e.g. Yes, I agree"
                value={aiPolicyAgreement}
                onChange={(e) => setAiPolicyAgreement(e.target.value)}
              />
            </Field>
            <Field label="Total years of experience (self-reported)">
              <Input
                type="number"
                placeholder="e.g. 8 — your full work history, not just what's on the tailored resume"
                value={totalYearsExperience}
                onChange={(e) => setTotalYearsExperience(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="requires-relocation"
              checked={requiresRelocationAssistance}
              onCheckedChange={(checked) => setRequiresRelocationAssistance(checked === true)}
            />
            <Label htmlFor="requires-relocation" className="font-normal">
              Requires relocation assistance
            </Label>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Education</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEducation((rows) => [...rows, { school: "", degree: "" }])}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {education.map((row, i) => (
          <div key={i} className="flex gap-2">
            <Input
              placeholder="School"
              value={row.school}
              onChange={(e) => updateEducation(i, "school", e.target.value)}
            />
            <Input
              placeholder="Degree"
              value={row.degree}
              onChange={(e) => updateEducation(i, "degree", e.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setEducation((rows) => rows.filter((_, idx) => idx !== i))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Target search criteria</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Role families (comma-separated)">
            <Input value={roleFamilies} onChange={(e) => setRoleFamilies(e.target.value)} />
          </Field>
          <Field label="Locations (comma-separated)">
            <Input value={locations} onChange={(e) => setLocations(e.target.value)} />
          </Field>
          <Field label="Industries (comma-separated)">
            <Input value={industries} onChange={(e) => setIndustries(e.target.value)} />
          </Field>
          <Field label="Salary floor">
            <Input type="number" value={salaryFloor} onChange={(e) => setSalaryFloor(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Button type="submit" disabled={saving} data-testid="profile-save">
        {saving ? "Saving..." : "Save profile"}
      </Button>
    </form>
  );
}
