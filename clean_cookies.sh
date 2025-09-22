#!/bin/bash

# Fix formatting issues from the previous script
find src/app/api -name "*.ts" -type f | while read file; do
    if grep -q "const cookieStore = await cookies(); const supabase = create" "$file"; then
        echo "Cleaning $file"
        
        # Create a temporary file
        temp_file=$(mktemp)
        
        # Fix the formatting by adding proper line breaks
        sed 's/const cookieStore = await cookies(); const supabase = create/const cookieStore = await cookies()\n    const supabase = create/g' "$file" > "$temp_file"
        
        # Replace the original file
        mv "$temp_file" "$file"
    fi
done
