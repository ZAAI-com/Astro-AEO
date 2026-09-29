### Generate .md Files

Every HTML page gets a companion `.md` file: your content stripped of Liquid tags, kramdown annotations, and layout noise. Just clean, structured markdown that LLMs can ingest directly.

```
/about/index.html  →  /about.md
/blog/my-post/     →  /blog/my-post.md
/products/widget/  →  /products/widget.md
```

### Validate Output

Verify your AEO output after every build:

```bash
bundle exec jekyll aeo:validate
```