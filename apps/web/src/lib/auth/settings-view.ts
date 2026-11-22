import "server-only";
import { isEncryptionConfigured } from "@/lib/crypto";
import { listUserKeys } from "./api-keys";
import { isAuthConfigured } from "./env";
import { getUser } from "./server";

export type SettingsView = {
  account: {
    state: "signed_in" | "signed_out" | "unavailable";
    email: string | null;
    signInHref: string | null;
    canSignOut: boolean;
  };
  cerebras: {
    state: "account_required" | "unavailable" | "not_connected" | "saved";
    last4: string | null;
    savedAt: string | null;
    /** A saved key is not proof of provider access or generation availability. */
    validation: "not_checked";
    actions: { save: boolean; check: boolean; replace: boolean; remove: boolean };
  };
};

function unavailable(): SettingsView {
  return {
    account: { state: "unavailable", email: null, signInHref: null, canSignOut: false },
    cerebras: {
      state: "unavailable", last4: null, savedAt: null, validation: "not_checked",
      actions: { save: false, check: false, replace: false, remove: false },
    },
  };
}

/** Minimal account/key presentation data. Call within the page's request-time Suspense boundary. */
export async function getSettingsView(): Promise<SettingsView> {
  const view = unavailable();
  if (!isAuthConfigured()) return view;

  let user;
  try {
    user = await getUser();
  } catch {
    return view;
  }
  // Local bypass identities and their temporary keys are not connected user accounts.
  if (user?.dev) return view;
  if (!user) {
    view.account = {
      state: "signed_out", email: null, signInHref: "/login?next=/settings", canSignOut: false,
    };
    view.cerebras.state = "account_required";
    return view;
  }

  view.account = { state: "signed_in", email: user.email, signInHref: null, canSignOut: true };
  try {
    const keys = await listUserKeys(user.id);
    const saved = keys.find((key) => key.provider === "cerebras");
    const encryptionReady = isEncryptionConfigured();
    view.cerebras = {
      state: encryptionReady ? (saved ? "saved" : "not_connected") : "unavailable",
      last4: saved ? saved.last4.slice(-4) : null,
      savedAt: saved?.createdAt ?? null,
      validation: "not_checked",
      actions: {
        save: encryptionReady && !saved,
        check: encryptionReady && Boolean(saved),
        replace: encryptionReady && Boolean(saved),
        remove: Boolean(saved),
      },
    };
  } catch {
    // An unavailable account store must not look like an empty or connected key.
  }
  return view;
}
