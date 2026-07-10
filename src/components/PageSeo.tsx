import { useEffect } from "react"

type PageSeoProps = {
  title: string
  description: string
  canonicalUrl: string
}

export default function PageSeo({
  title,
  description,
  canonicalUrl,
}: PageSeoProps) {
  useEffect(() => {
    const previousTitle = document.title

    let descriptionMeta =
      document.querySelector<HTMLMetaElement>(
        'meta[name="description"]',
      )
    const createdDescriptionMeta = !descriptionMeta
    const previousDescription =
      descriptionMeta?.getAttribute("content") ?? null

    if (!descriptionMeta) {
      descriptionMeta = document.createElement("meta")
      descriptionMeta.name = "description"
      document.head.appendChild(descriptionMeta)
    }

    let canonicalLink =
      document.querySelector<HTMLLinkElement>(
        'link[rel="canonical"]',
      )
    const createdCanonicalLink = !canonicalLink
    const previousCanonicalUrl =
      canonicalLink?.getAttribute("href") ?? null

    if (!canonicalLink) {
      canonicalLink = document.createElement("link")
      canonicalLink.rel = "canonical"
      document.head.appendChild(canonicalLink)
    }

    document.title = title
    descriptionMeta.content = description
    canonicalLink.href = canonicalUrl

    return () => {
      document.title = previousTitle

      if (createdDescriptionMeta) {
        descriptionMeta.remove()
      } else if (previousDescription === null) {
        descriptionMeta.removeAttribute("content")
      } else {
        descriptionMeta.content = previousDescription
      }

      if (createdCanonicalLink) {
        canonicalLink.remove()
      } else if (previousCanonicalUrl === null) {
        canonicalLink.removeAttribute("href")
      } else {
        canonicalLink.href = previousCanonicalUrl
      }
    }
  }, [canonicalUrl, description, title])

  return null
}
