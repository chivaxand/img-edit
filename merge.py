#!/usr/bin/env python3

import re
import os

# merge js and css files into one html

def main():
    replace_scripts_and_styles('img-edit.html')


def replace_scripts_and_styles(html_file, result_file=None):
    if result_file is None:
        html_dir = os.path.dirname(html_file)
        html_name = os.path.basename(html_file)
        result_file = os.path.join(html_dir, f'_{html_name}')

    html_content = ''
    with open(html_file, 'r') as file:
        html_content = file.read()

    # Function to replace JS
    def replace_script(match):
        script_tag = match.group(0)
        file_path = match.group(1) 
        try:
            file_path = os.path.join(os.path.dirname(html_file), file_path)
            with open(file_path, 'r') as script_file:
                return '<script type="text/javascript">\n' + script_file.read() + '\n</script>\n'
        except FileNotFoundError:
            return script_tag

    # Function to replace CSS
    def replace_style(match):
        style_tag = match.group(0)
        file_path = match.group(1)
        try:
            file_path = os.path.join(os.path.dirname(html_file), file_path)
            with open(file_path, 'r') as style_file:
                return '<style>\n' + style_file.read() + '\n</style>\n'
        except FileNotFoundError:
            return style_tag

    script_pattern = r'<script\s+[^>]*src="([^"]+)"[^>]*></script>'
    style_pattern = r'<link\s+[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>'

    updated_html = re.sub(script_pattern, replace_script, html_content)
    updated_html = re.sub(style_pattern, replace_style, updated_html)

    with open(result_file, 'w') as result_file:
        result_file.write(updated_html)


if __name__ == "__main__":
    script_path = os.path.dirname(os.path.realpath(__file__))
    os.chdir(script_path)
    print('\n==================================================\n')
    main()