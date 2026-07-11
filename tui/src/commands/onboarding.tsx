import type { Command } from "./registry.js";
import { OnboardingOverlay } from "../components/OnboardingOverlay.js";

export const onboardingCommand: Command = {
  name: "onboarding",
  aliases: [],
  description: "Re-run the setup wizard (data path, provider, import, harness install)",
  usage: "/onboarding",

  async execute(_args, ctx) {
    ctx.showOverlay((hideOverlay, _hideForEditor) => (
      <OnboardingOverlay
        onDismiss={hideOverlay}
        detectedProviders={ctx.ei.detectedProviders()}
        isFirstBoot={false}
        dataPath={ctx.ei.dataPath()}
      />
    ), ctx.renderer);
  },
};
