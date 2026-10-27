"""Makes tests/fixtures/outline-reportlab.pdf: a three-page paper-shaped PDF with no /Title, an outline
(bookmarks, one nested), and a first page that carries an identifier stamped up the margin in larger type
than the title, the way arXiv stamps its papers. Needs: pip install reportlab. Run from the repo root."""
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("tests/fixtures/outline-reportlab.pdf", pagesize=letter)
c.setTitle("")  # no document title, so a reader has to say where its guess comes from
c.setAuthor("")

# Page 1: the identifier is larger than the title and runs up the margin.
c.saveState()
c.translate(30, 200)
c.rotate(90)
c.setFont("Helvetica", 20)
c.drawString(0, 0, "arXiv:2501.01234v1 [cs.CL] 2 Jan 2025")
c.restoreState()
c.setFont("Helvetica-Bold", 17)
c.drawCentredString(306, 700, "Lanterns in the Margin: A Study")
c.drawCentredString(306, 678, "of Footnotes")
c.setFont("Helvetica", 10)
c.drawCentredString(306, 650, "Ada North and B. Winter")
c.setFont("Helvetica", 11)
c.bookmarkPage("intro")
c.addOutlineEntry("1 Introduction", "intro", level=0)
c.drawString(72, 600, "Footnotes carry the argument that the main text leaves unsaid.")
c.showPage()

c.setFont("Helvetica", 11)
c.bookmarkPage("method")
c.addOutlineEntry("2 Method", "method", level=0)
c.drawString(72, 700, "We read forty books and counted every note.")
c.bookmarkPage("method-notes")
c.addOutlineEntry("2.1 Counting notes", "method-notes", level=1)
c.drawString(72, 660, "A note is anything the author set apart from the line.")
c.showPage()

c.setFont("Helvetica", 11)
c.bookmarkPage("results")
c.addOutlineEntry("3 Results", "results", level=0)
c.drawString(72, 700, "Most notes were short, and most were useful.")
c.showPage()
c.save()
