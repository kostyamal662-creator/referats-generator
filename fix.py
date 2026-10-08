try:
    with open('script.js', 'r', encoding='utf-8') as f:
        text = f.read()
    
    # Encode with cp1251, fallback to cp1252 if cp1251 fails, or just ignore errors
    # Wait, if we use errors='ignore', we might drop characters. Let's use 'replace'
    # Actually, we can encode with 'latin-1' or whatever powershell used if it wasn't cp1251.
    # But Windows Cyrillic is cp1251.
    
    bytes_val = b''
    for c in text:
        try:
            bytes_val += c.encode('windows-1251')
        except UnicodeEncodeError:
            try:
                bytes_val += c.encode('latin-1')
            except UnicodeEncodeError:
                bytes_val += b'?'
                
    fixed_text = bytes_val.decode('utf-8', errors='ignore')
    
    with open('script.js', 'w', encoding='utf-8') as f:
        f.write(fixed_text)
    print("Fixed!")
except Exception as e:
    print("Error:", e)
