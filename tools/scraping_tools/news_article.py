from datetime import datetime

class NewsArticle:

  def __init__(self, organization: str, url: str, title: str, description: str, date_published: datetime, author: str, content: str, date_extracted: datetime, extraction_status: str, categories: list[str]):
    self.organization = organization
    self.url = url
    self.title = title
    self.description = description
    self.date_published = date_published
    self.author = author
    self.content = content
    self.date_extracted = date_extracted
    self.extraction_status = extraction_status
    self.categories = categories
  
  def as_dict(self):
    return {
      "organization": self.organization,
      "url": self.url,
      "title": self.title,
      "description": self.description,
      "date_published": self.date_published,
      "author": self.author,
      "content": self.content,
      "date_extracted": self.date_extracted,
      "extraction_status": self.extraction_status,
      "categories": self.categories
    }