export const feedbackTones = ["positive", "negative", "idea"] as const
export type FeedbackTone = typeof feedbackTones[number]

export const feedbackTopics = [
  "General", "CSV / TXT to DXF", "GIS Export", "LandXML Viewer",
  "Surface Compare", "Cross Section", "Coordinate Converter", "Pavement Conformance",
] as const

export type FeedbackInput = {
  tone: FeedbackTone
  topic: string
  message: string
  email: string
}

export function parseFeedback(value: unknown): FeedbackInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Please enter your feedback.")
  const input = value as Record<string, unknown>
  if (!feedbackTones.includes(input.tone as FeedbackTone)) throw new Error("Choose a feedback type.")
  if (typeof input.topic !== "string" || !feedbackTopics.includes(input.topic as typeof feedbackTopics[number])) throw new Error("Choose a tool or General.")
  const message = typeof input.message === "string" ? input.message.trim() : ""
  if (message.length < 5 || message.length > 2000) throw new Error("Please use between 5 and 2,000 characters for your feedback.")
  const email = typeof input.email === "string" ? input.email.trim() : ""
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("Enter a valid email address, or leave it blank.")
  return { tone: input.tone as FeedbackTone, topic: input.topic, message, email }
}

export function feedbackIssueUrl(feedback: Pick<FeedbackInput, "tone" | "topic" | "message">) {
  const labels = { positive: "Positive feedback", negative: "Issue / improvement", idea: "Question / idea" }
  const url = new URL("https://github.com/cagilakguc/surveytool/issues/new")
  url.searchParams.set("title", `[${labels[feedback.tone]}] ${feedback.topic}`)
  url.searchParams.set("body", `Feedback type: ${labels[feedback.tone]}\nTool: ${feedback.topic}\n\n${feedback.message.trim().slice(0, 2000)}`)
  return url.toString()
}
