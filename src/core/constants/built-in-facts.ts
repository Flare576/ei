/**
 * Built-in biographical fact categories that Ei tracks.
 * These represent the 25 known-category facts for the structured fact model.
 *
 * BUILT_IN_FACTS: Array of fact objects (name field only) for iteration/display.
 * BUILT_IN_FACT_NAMES: Set<string> for O(1) lookup (is this fact built-in?).
 */

export const BUILT_IN_FACTS: { name: string }[] = [
  // Core Identity
  { name: "Full Name" },
  { name: "Nickname/Preferred Name" },
  { name: "Birthday" },
  { name: "Age" },
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
  { name: "Children" },
  { name: "Gender" },
  { name: "Pronouns" },
  { name: "Eye Color" },
  { name: "Hair Color" },
  { name: "Height" },

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
