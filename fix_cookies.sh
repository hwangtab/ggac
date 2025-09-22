#!/bin/bash

# Find all TypeScript files with the problematic pattern and fix them
find src/app/api -name "*.ts" -type f | while read file; do
    # Check if file contains the patterns we need to fix
    if grep -q "createServerComponentClient({ cookies })" "$file" || grep -q "createRouteHandlerClient({ cookies })" "$file"; then
        echo "Fixing $file"
        
        # Create a temporary file
        temp_file=$(mktemp)
        
        # Apply the fixes
        sed 's/const supabase = createServerComponentClient({ cookies })/const cookieStore = await cookies(); const supabase = createServerComponentClient({ cookies: () => cookieStore as any })/g' "$file" |
        sed 's/const supabase = createRouteHandlerClient({ cookies })/const cookieStore = await cookies(); const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })/g' > "$temp_file"
        
        # Replace the original file
        mv "$temp_file" "$file"
    fi
done
