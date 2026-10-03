from datetime import datetime

class NewsArticle:

  def __init__(self, organization: str, url: str, title: str, date_published: datetime, author: str, content: str):
    self.organization = organization
    self.url = url
    self.title = title
    self.date_published = date_published
    self.author = author
    self.content = content
  
  def as_dict(self):
    return {
      "organization": self.organization,
      "url": self.url,
      "title": self.title,
      "date_published": self.date_published,
      "author": self.author,
      "content": self.content
    }