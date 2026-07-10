export type PointFileDelimiter =
  | "comma"
  | "tab"
  | "semicolon"
  | "whitespace"

const delimiterLabels: Record<PointFileDelimiter, string> = {
  comma: "Comma-separated",
  tab: "Tab-separated",
  semicolon: "Semicolon-separated",
  whitespace: "Whitespace-separated",
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = []
  let cell = ""
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (character === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }
      continue
    }

    if (character === delimiter && !insideQuotes) {
      cells.push(cell.trim())
      cell = ""
      continue
    }

    cell += character
  }

  cells.push(cell.trim())
  return cells
}

function splitLine(line: string, delimiter: PointFileDelimiter) {
  if (delimiter === "whitespace") {
    return line.trim().split(/\s+/).map((cell) => cell.trim())
  }

  const character =
    delimiter === "comma"
      ? ","
      : delimiter === "tab"
        ? "\t"
        : ";"

  return splitDelimitedLine(line, character)
}

function scoreDelimiter(
  lines: string[],
  delimiter: PointFileDelimiter,
) {
  const frequencies = new Map<number, number>()

  lines.forEach((line) => {
    const columnCount = splitLine(line, delimiter).length
    if (columnCount > 1) {
      frequencies.set(
        columnCount,
        (frequencies.get(columnCount) ?? 0) + 1,
      )
    }
  })

  let mostCommonColumns = 0
  let mostCommonFrequency = 0

  frequencies.forEach((frequency, columnCount) => {
    if (
      frequency > mostCommonFrequency ||
      (frequency === mostCommonFrequency &&
        columnCount > mostCommonColumns)
    ) {
      mostCommonFrequency = frequency
      mostCommonColumns = columnCount
    }
  })

  if (mostCommonColumns < 2) {
    return 0
  }

  return (
    (mostCommonFrequency / Math.max(lines.length, 1)) * 1000 +
    Math.min(mostCommonColumns, 50)
  )
}

export function parsePointFileText(text: string) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")

  const sampleLines = lines.slice(0, 25)
  const candidates: PointFileDelimiter[] = [
    "comma",
    "tab",
    "semicolon",
    "whitespace",
  ]

  let delimiter: PointFileDelimiter = "whitespace"
  let highestScore = 0

  candidates.forEach((candidate) => {
    const score = scoreDelimiter(sampleLines, candidate)
    if (score > highestScore) {
      highestScore = score
      delimiter = candidate
    }
  })

  return {
    rows: lines.map((line) => splitLine(line, delimiter)),
    delimiter,
    delimiterLabel: delimiterLabels[delimiter],
  }
}
