export type StatusTone = "idle" | "success" | "error";
export type StatusVisibility = "visible" | "fading" | "collapsed";

export interface StatusMessage {
  tone: StatusTone;
  text: string;
  autoFade?: boolean;
}
