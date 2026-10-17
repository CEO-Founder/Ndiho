// Response shapes of the Ndiho API, as seen by the browser.

export type Role = "therapist" | "patient";
export type CallStatus = "ringing" | "accepted" | "rejected" | "cancelled" | "missed" | "ended";

export interface Account {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  phone: string | null;
  createdAt: string;
  therapist?: {
    professionalTitle: string;
    licenseNumber: string;
    licensingBody: string;
    licenseCountry: string;
    yearsExperience: number;
    specialties: string[];
    languages: string[];
    bio: string;
    sessionFeeRwf: number | null;
    verificationStatus: "pending" | "verified" | "rejected";
    verifiedAt: string | null;
  };
  patient?: {
    dateOfBirth: string | null;
    gender: string | null;
    preferredLanguage: string | null;
    country: string | null;
    city: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
}

export interface PublicTherapist {
  id: string;
  fullName: string;
  professionalTitle: string;
  yearsExperience: number;
  specialties: string[];
  languages: string[];
  bio: string;
  sessionFeeRwf: number | null;
  licensingBody: string;
  licenseCountry: string;
}

export interface CallParticipant {
  id: string;
  fullName: string;
  role: Role;
}

export interface CallView {
  id: string;
  status: CallStatus;
  callerId: string;
  therapist: CallParticipant;
  patient: CallParticipant;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  ringTimeoutSeconds: number;
}
