ASSETS_DIR=public/assets

TXT_FILES = \
	$(ASSETS_DIR)/facts.txt \
	$(ASSETS_DIR)/memories.txt \
	$(ASSETS_DIR)/jokes.txt \
	$(ASSETS_DIR)/prompts.txt

# Default target: create extra text files if missing
all: $(TXT_FILES)

$(ASSETS_DIR)/%.txt:
	@mkdir -p $(ASSETS_DIR)
	@test -f $@ || echo "# $* file created $(shell date)" > $@
	@echo "Created $@"