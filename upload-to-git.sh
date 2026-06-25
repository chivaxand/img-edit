#!/bin/bash

# Exit immediately if any command fails
set -e

GIT_REMOTE_URL="git@github.com:chivaxand/img-edit.git"
GIT_NAME="chivaxand"
GIT_EMAIL="30089819+chivaxand@users.noreply.github.com"

COMMIT_MSG="${1:-Release}"
CURRENT_DIR=$(pwd)
SCRIPT_NAME=$(basename "$0")

# Create a unique temporary directory
TEMP_DIR=$(mktemp -d -t deploy-git-repo)

# Ensure the temporary directory is ALWAYS deleted when the script exits
cleanup() {
    echo "🧹 Cleaning up temporary files..."
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "Starting deployment to GitHub..."
echo "Summary:"
echo "----------------------------------------"
echo "Source Folder: $CURRENT_DIR"
echo "GitHub Repo:   $GIT_REMOTE_URL"
echo "Commit Message: \"$COMMIT_MSG\""
echo "----------------------------------------"
echo ""

# Clone the target repository into the temporary directory
echo "Cloning remote repository into a temporary folder..."
git clone --depth 1 "$GIT_REMOTE_URL" "$TEMP_DIR"

# 3. Sync files and clean up stale files
echo "Syncing files..."
rsync -a --delete \
    --exclude='.git/' \
    --exclude="$SCRIPT_NAME" \
    ./ "$TEMP_DIR/"

# Prepare the commit in the temporary directory
cd "$TEMP_DIR"
git add -A

# Check if there are actually any changes to commit
if git diff-index --quiet HEAD --; then
    echo "No changes detected. Nothing to push."
    exit 0
fi

git config user.name "$GIT_NAME"
git config user.email "$GIT_EMAIL"
git commit -m "$COMMIT_MSG"
echo ""

git log -1
echo ""

# Detect the default branch name of the cloned repo (e.g. main or master)
BRANCH_NAME=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")

echo "Temp directory: $TEMP_DIR"
# Show changed files here
echo "Changed files (M = Modified, A = Added, D = Deleted):"
echo "----------------------------------------"
git diff-tree --no-commit-id --name-status -r --root HEAD
echo "----------------------------------------"

# Ask for confirmation before pushing
echo ""
read -p "⚠️  Are you sure you want to push these changes to GitHub? (y/N): " response
case "$response" in
    [yY]|[yY][eE][sS])
        echo "Pushing to branch '$BRANCH_NAME'..."
        git push origin "$BRANCH_NAME"
        echo "✅ Successfully published: \"$COMMIT_MSG\""
        ;;
    *)
        echo "❌ Push cancelled. No changes were uploaded to GitHub."
        ;;
esac

# Note: The 'trap cleanup EXIT' will now automatically execute here and delete $TEMP_DIR.