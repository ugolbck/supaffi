import type { FetchedProgram, ImportSourceKey } from "../types";
import { fetchAffonso } from "./affonso";
import { fetchFirstPromoter } from "./firstpromoter";
import { fetchRewardful } from "./rewardful";
import { fetchTolt } from "./tolt";

/** Reads everything the other tool's API gives about the program. */
export function fetchProgram(source: ImportSourceKey, apiKey: string, accountId: string | null): Promise<FetchedProgram> {
  switch (source) {
    case "REWARDFUL":
      return fetchRewardful(apiKey);
    case "TOLT":
      return fetchTolt(apiKey);
    case "FIRSTPROMOTER":
      return fetchFirstPromoter(apiKey, accountId ?? "");
    case "AFFONSO":
      return fetchAffonso(apiKey);
  }
}
