import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = dirname(fileURLToPath(import.meta.url));

const industryNames = [
  "Technology", "Banking", "Fintech", "Insurance", "Healthcare",
  "Pharmaceuticals", "Education", "Retail", "E-Commerce", "Manufacturing",
  "Logistics & Supply Chain", "Telecommunications", "Media & Entertainment",
  "Energy & Utilities", "Construction & Real Estate", "Government & Public Sector",
  "Non-Profit", "Consulting", "Legal", "Automotive", "Aerospace & Defence",
  "Agriculture", "Mining & Resources", "Food & Beverage", "Hospitality & Tourism",
];

const companyNames = [
  "Standard Bank", "FNB", "TymeBank", "IBM", "Discovery", "Absa", "Ogilvy",
  "Naspers", "PwC", "Nedbank", "Capitec", "Investec", "Accenture",
  "Anglo American", "Vodacom", "Shoprite", "Takealot", "Woolworths",
  "Sasol", "MTN", "Sanlam", "Old Mutual", "Bidvest", "Transnet", "Telkom",
  "Mediclinic", "Netcare", "Massmart", "Dimension Data", "Deloitte",
  "KPMG", "BuildRight",
];

const positions = [
  "Software Engineer", "Data Engineer", "Product Manager", "UX Designer",
  "Project Manager", "Business Analyst", "Cloud Architect", "DevOps Engineer",
  "Financial Analyst", "Marketing Specialist", "Cybersecurity Analyst",
  "Operations Manager", "Human Resources Partner", "Sales Executive",
  "Mechanical Engineer", "Legal Counsel", "Network Engineer", "Data Scientist",
];

const locations = [
  "Johannesburg, Gauteng", "Cape Town, Western Cape", "Durban, KwaZulu-Natal",
  "Pretoria, Gauteng", "Gqeberha, Eastern Cape", "Bloemfontein, Free State",
  "Polokwane, Limpopo", "Mbombela, Mpumalanga", "Remote, South Africa",
];

const firstNames = [
  "Ayanda", "Thabo", "Lerato", "Sipho", "Naledi", "Michael", "Ayesha",
  "Bongani", "Nomsa", "Kagiso", "Zanele", "Daniel", "Priya", "Refilwe",
];
const lastNames = [
  "Maseko", "Nkosi", "Dlamini", "Naidoo", "Mokoena", "Smith", "Patel",
  "Cele", "Botha", "Khumalo", "Pillay", "Jacobs", "Mahlangu", "Williams",
];

const jobStatuses = ["DRAFT", "POSTED", "PAUSED", "FILLED", "CANCELLED", "CLOSED"];
const employmentTypes = ["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "INTERNSHIP", "FREELANCE"];
const workTypes = ["REMOTE", "HYBRID", "ONSITE"];
const priorities = ["LOW", "NORMAL", "HIGH", "CRITICAL"];
const candidateStatuses = ["SUBMITTED", "ACTIVE", "ON_HOLD", "CLOSED", "CANCELLED", "REJECTED", "APPLIED"];
const skills = [
  "JavaScript", "TypeScript", "Node.js", "React", "Java", "Python", "AWS",
  "SQL", "Figma", "Agile Delivery", "Financial Modelling", "Stakeholder Management",
];

function uuid(namespace, index) {
  const prefix = namespace.toString(16).padStart(8, "0");
  return `${prefix}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function isoDaysFromNow(days) {
  const date = new Date();
  date.setUTCHours(9, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function dateDaysFromNow(days) {
  return isoDaysFromNow(days).slice(0, 10);
}

export function createIndustries() {
  return industryNames.map((industryName, index) => ({
    industryId: uuid(1, index + 1),
    industryName,
    normalizedKey: slug(industryName),
  }));
}

export function createCompanies() {
  return companyNames.map((clientName, index) => {
    const contactFirstName = firstNames[index % firstNames.length];
    const contactLastName = lastNames[(index + 3) % lastNames.length];
    return {
      clientId: uuid(2, index + 1),
      clientName,
      contactName: `${contactFirstName} ${contactLastName}`,
      contactEmail: `${contactFirstName}.${contactLastName}@${slug(clientName).replaceAll("_", "")}.co.za`.toLowerCase(),
      contactPhoneNumber: `+2782${String(1000000 + index).padStart(7, "0")}`,
    };
  });
}

export function createJobs(industries, companies, count = 120) {
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    const status = jobStatuses[index % jobStatuses.length];
    const client = companies[index % companies.length];
    const industry = industries[(index * 3) % industries.length];
    const positionTitle = `${index % 4 === 0 ? "Senior " : ""}${positions[index % positions.length]}`;
    const publishedDaysAgo = index % 45;
    const publishedAt = status === "DRAFT" ? null : isoDaysFromNow(-publishedDaysAgo);
    const createdAt = isoDaysFromNow(-(publishedDaysAgo + 14));
    const salaryMin = 28000 + (index % 15) * 5000;
    const skillStart = index % skills.length;
    const jobSkills = [0, 1, 2].map((offset) => ({
      skillId: uuid(5, ((skillStart + offset) % skills.length) + 1),
      originalText: skills[(skillStart + offset) % skills.length],
      sourceType: offset === 0 && index % 2 === 0 ? "AI_GENERATED" : "RECRUITER_ENTERED",
    }));

    return {
      jobProfileId: uuid(3, sequence),
      jobReferenceNumber: `JOB-${new Date().getUTCFullYear()}-${String(sequence).padStart(4, "0")}`,
      clientId: client.clientId,
      positionTitle,
      industryId: industry.industryId,
      locationText: locations[index % locations.length],
      employmentType: employmentTypes[index % employmentTypes.length],
      workType: workTypes[index % workTypes.length],
      experienceLevel: ["Entry", "Mid", "Senior", "Executive"][index % 4],
      priority: priorities[index % priorities.length],
      salaryMin,
      salaryMax: salaryMin + 18000 + (index % 5) * 2000,
      currencyCode: "ZAR",
      clientRate: 7.5 + (index % 8),
      jobDescription: `${client.clientName} is seeking a ${positionTitle} to deliver measurable outcomes across its ${industry.industryName.toLowerCase()} portfolio. This role collaborates with multidisciplinary teams and senior stakeholders.`,
      requirements: ["Relevant tertiary qualification", `${2 + (index % 7)} years of relevant experience`],
      responsibilities: ["Own delivery outcomes", "Collaborate with internal and external stakeholders"],
      benefitsText: ["Medical aid contribution", index % 2 ? "Flexible working hours" : "Professional development budget"],
      skills: jobSkills,
      fillByDate: dateDaysFromNow(20 + (index % 90)),
      status,
      publishedAt,
      createdAt,
      updatedAt: publishedAt ?? createdAt,
      closedAt: ["FILLED", "CANCELLED", "CLOSED"].includes(status) ? isoDaysFromNow(-(index % 10)) : null,
      createdByUserId: uuid(6, (index % 8) + 1),
      recruiterId: `r${String((index % 6) + 1).padStart(3, "0")}`,
      versionNo: 1 + (index % 4),
      viewCount: 20 + ((index * 37) % 480),
      applicantCount: 1 + ((index * 13) % 75),
    };
  });
}

export function createCandidates(jobs, companies, count = 240) {
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    const job = jobs[index % jobs.length];
    const company = companies[(index * 5) % companies.length];
    const firstName = firstNames[index % firstNames.length];
    const lastName = lastNames[(index * 3) % lastNames.length];
    return {
      applicationId: uuid(7, sequence),
      candidateId: uuid(4, sequence),
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      title: positions[(index * 7) % positions.length],
      clientId: company.clientId,
      companyName: company.clientName,
      locationText: locations[(index * 2) % locations.length],
      matchPercentage: 55 + ((index * 11) % 45),
      status: candidateStatuses[index % candidateStatuses.length],
      jobProfileId: job.jobProfileId,
    };
  });
}

export function createDashboardSummary(candidates) {
  return {
    cvsDue: candidates.filter(({ status }) => status === "SUBMITTED").length,
    interviewsToSchedule: candidates.filter(({ status }) => status === "ACTIVE").length,
    offerLettersAcceptanceDeadlines: candidates.filter(({ status }) => status === "ON_HOLD").length,
  };
}

function writeDataset(name, data) {
  writeFileSync(join(outputDirectory, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

function readDataset(name) {
  return JSON.parse(readFileSync(join(outputDirectory, `${name}.json`), "utf8"));
}

function resolveJobProfileId(reference, jobs) {
  const value = typeof reference === "string"
    ? reference
    : reference?.jobProfileId ?? reference?.jobId;
  if (jobs.some(({ jobProfileId }) => jobProfileId === value)) return value;
  const legacySequence = /^j(\d+)$/i.exec(value ?? "");
  return legacySequence ? jobs[Number(legacySequence[1]) - 1]?.jobProfileId ?? null : null;
}

function migrateCandidateSavedJobs(profiles, jobs) {
  const postedJobs = jobs.filter(({ status }) => status === "POSTED");
  return profiles.map((profile, profileIndex) => ({
    ...profile,
    savedJobs: (profile.savedJobs ?? []).flatMap((entry, entryIndex) => {
      const resolvedJobProfileId = resolveJobProfileId(entry, jobs);
      const resolvedJob = jobs.find(({ jobProfileId }) => jobProfileId === resolvedJobProfileId);
      const jobProfileId = resolvedJob?.status === "POSTED"
        ? resolvedJob.jobProfileId
        : postedJobs[(profileIndex * 2 + entryIndex) % postedJobs.length]?.jobProfileId;
      if (!jobProfileId) return [];
      return [{
        jobProfileId,
        savedAt: typeof entry === "object" ? entry.savedAt ?? null : null,
      }];
    }),
  }));
}

function migrateUserSavedJobs(users, jobs) {
  const postedJobs = jobs.filter(({ status }) => status === "POSTED");
  return users.map((user, userIndex) => ({
    ...user,
    savedJobs: (user.savedJobs ?? [])
      .map((entry, entryIndex) => {
        const resolvedJobProfileId = resolveJobProfileId(entry, jobs);
        const resolvedJob = jobs.find(({ jobProfileId }) => jobProfileId === resolvedJobProfileId);
        return resolvedJob?.status === "POSTED"
          ? resolvedJob.jobProfileId
          : postedJobs[(userIndex * 3 + entryIndex) % postedJobs.length]?.jobProfileId;
      })
      .filter(Boolean),
  }));
}

function migrateApplications(applications, jobs, companies) {
  const postedJobs = jobs.filter(({ status }) => status === "POSTED");
  return applications.map((application, index) => {
    const resolvedJobProfileId = resolveJobProfileId(
      application.jobProfileId ?? application.jobId,
      jobs,
    );
    const resolvedJob = jobs.find(({ jobProfileId }) => jobProfileId === resolvedJobProfileId);
    const job = resolvedJob?.status === "POSTED"
      ? resolvedJob
      : postedJobs[(index + 2) % postedJobs.length];
    const company = companies.find(({ clientId }) => clientId === job.clientId);
    return {
      ...application,
      applicationId: uuid(8, index + 1),
      jobId: job.jobProfileId,
      jobProfileId: job.jobProfileId,
      jobTitle: job.positionTitle,
      company: company?.clientName ?? "",
      applicationStatus: application.currentStage === "Inbound" ? "SUBMITTED" : "ACTIVE",
    };
  });
}

function migrateProfileApplications(profiles, applications) {
  const applicationsByUser = new Map();
  for (const application of applications) {
    if (!application.userId) continue;
    const userApplications = applicationsByUser.get(application.userId) ?? [];
    userApplications.push(application);
    applicationsByUser.set(application.userId, userApplications);
  }
  return profiles.map((profile) => ({
    ...profile,
    applications: applicationsByUser.get(profile.userId) ?? [],
  }));
}

const industries = createIndustries();
const companies = createCompanies();
const jobs = createJobs(industries, companies);
const candidates = createCandidates(jobs, companies);
const applications = migrateApplications(readDataset("applications"), jobs, companies);
const candidateProfiles = migrateProfileApplications(
  migrateCandidateSavedJobs(readDataset("candidate-profiles"), jobs),
  applications,
);

writeDataset("industries", industries);
writeDataset("companies", companies);
writeDataset("jobs", jobs);
writeDataset("candidates", candidates);
writeDataset("dashboard-summary", createDashboardSummary(candidates));
writeDataset("applications", applications);
writeDataset("candidate-profiles", candidateProfiles);
writeDataset("users", migrateUserSavedJobs(readDataset("users"), jobs));

console.log(`Generated ${industries.length} industries, ${companies.length} companies, ${jobs.length} jobs and ${candidates.length} candidates with canonical saved-job relationships.`);