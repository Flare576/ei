/**
 * Built-in biographical fact categories that Ei tracks.
 *
 * BUILT_IN_FACTS: Array of fact objects (name field only) for iteration/display.
 * BUILT_IN_FACT_NAMES: Set<string> for O(1) lookup (is this fact built-in?).
 *
 * This list has grown past earlier internal drafts that capped it at a fixed
 * count. There is no hard limit — keep it to a reasonable set of information
 * a human would actually want an Agent or Persona to remember, not a number.
 */

export const BUILT_IN_FACTS: { name: string }[] = [
  // Core Identity
  { name: "Full Name" },
  { name: "Nickname/Preferred Name" },
  { name: "Birthday" },
  { name: "Birthplace" },
  { name: "Hometown" },
  { name: "Current Location" },

  // Professional
  { name: "Current Job Title" },
  { name: "Current Employer" },
  { name: "Industry/Field" },
  { name: "Years of Experience" },

  // Personal
  { name: "Marital Status" },
  { name: "Spouse Name" },
  { name: "Spouse Birthday" },
  { name: "Date of Marriage" },
  { name: "Children" },
  { name: "Parents" },
  { name: "Gender" },
  { name: "Pronouns" },
  { name: "Eye Color" },
  { name: "Hair Color" },
  { name: "Height" },
  { name: "Weight" },

  // Background
  { name: "Nationality/Citizenship" },
  { name: "Languages Spoken" },
  { name: "Education Level" },
  { name: "School/University" },
  { name: "Field of Study" },
  { name: "Military Service" },
  { name: "Religious Affiliation" },
];

export const BUILT_IN_FACT_NAMES: Set<string> = new Set(
  BUILT_IN_FACTS.map((f) => f.name)
);
