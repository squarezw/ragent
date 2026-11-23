import type { NextApiRequest, NextApiResponse } from "next";
import { proxySpeechSynthesis } from "@/lib/speechSynthesisProxy";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySpeechSynthesis(req, res, "synthesize");
}
