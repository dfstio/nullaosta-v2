import AccountData from "./accountData";

export default interface UserData {
  id: string;
  username?: string;
  message_id: string;
  language_code: string;
  voice?: boolean;
  user?: any;
  first_name?: string;
  last_name?: string;
  is_bot?: boolean;
  isWhitelisted?: boolean;
  isPaid?: boolean;
  firstSeen?: number;
  firstSeenDate?: string;
  lastSeen?: number;
  lastSeenDate?: string;
}
