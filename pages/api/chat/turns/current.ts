import type { NextApiRequest, NextApiResponse } from "next";
import { proxyChatTurn } from "@/lib/chatTurnsProxy";
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxyChatTurn(req, res, "current");
}
