import java.nio.file.*;
import java.sql.*;
import java.util.*;

/** Compare application rows, not H2 page layout or Flyway execution timestamps. */
public final class VerifyExample {
    static long count(Connection db, String table, String where) throws Exception {
        try(var rs=db.createStatement().executeQuery("SELECT COUNT(*) FROM " + table + where)) { rs.next();return rs.getLong(1); }
    }
    public static void main(String[] args) throws Exception {
        try(var db=DriverManager.getConnection("jdbc:h2:file:"+args[0]+";IFEXISTS=TRUE", "sa", "")) {
            try(var profile=db.createStatement().executeQuery("SELECT CITY, STATE, AVATAR, BANNER, BIO, HEADLINE, COMPANY, AVAILABILITY, PORTFOLIO FROM USERS WHERE ID='example_lia'")) {
                if(!profile.next())throw new IllegalStateException("Main fictional profile missing");
                for(int i=1;i<=9;i++)if(profile.getString(i)==null||profile.getString(i).isBlank())throw new IllegalStateException("Main fictional profile incomplete");
            }
            long[] expected={4,8,6,2,8,3};
            long[] actual={count(db,"USERS",""),count(db,"POSTS",""),count(db,"COMMENTS"," WHERE PARENT_COMMENT_ID IS NULL"),count(db,"COMMENTS"," WHERE PARENT_COMMENT_ID IS NOT NULL"),count(db,"REACTIONS",""),count(db,"POST_MEDIA","")};
            if(!Arrays.equals(expected,actual))throw new IllegalStateException("Fictional dataset counts differ");
            if(count(db,"USER_CREDENTIALS"," WHERE PASSWORD_USABLE=TRUE")!=0)throw new IllegalStateException("Example seed must have no usable original passwords");
            List<String> rows=new ArrayList<>();
            for(String table:List.of("USERS","USER_CREDENTIALS","USER_SKILLS","USER_GOALS","USER_EXTERNAL_LINKS","POSTS","POST_MEDIA","MEDIA_ASSETS","COMMENTS","REACTIONS")) {
                try(var rs=db.createStatement().executeQuery("SELECT * FROM "+table)) {
                    var metadata=rs.getMetaData();
                    while(rs.next()) {
                        List<String> columns=new ArrayList<>();
                        for(int i=1;i<=metadata.getColumnCount();i++) {
                            Object value=rs.getObject(i);
                            columns.add(metadata.getColumnName(i)+"="+(value==null?"NULL":Base64.getEncoder().encodeToString(value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8))));
                        }
                        Collections.sort(columns); rows.add(table+"\t"+String.join("\t",columns));
                    }
                }
            }
            Collections.sort(rows);Files.write(Path.of(args[1]),rows);
            System.out.println("{\"users\":4,\"posts\":8,\"comments\":6,\"replies\":2,\"reactions\":8,\"postsWithImages\":3}");
        }
    }
}
